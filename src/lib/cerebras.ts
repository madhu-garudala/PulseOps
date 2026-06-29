/**
 * Server-side Cerebras client + generic structured-output helper.
 *
 * This is the single engine every agent (Observer / Triage / Commander) will
 * call. It implements the §4.3 contract from plan.md:
 *   1. Request strict structured output (response_format json_schema, strict:true)
 *   2. Validate the parsed JSON with Zod
 *   3. On failure: ONE repair retry (re-prompt to fix the JSON), then fail hard
 *
 * Docs pinned (Cerebras, current):
 *   response_format: { type:'json_schema', json_schema:{ name, strict:true, schema } }
 *   strict mode requires additionalProperties:false on every object.
 *   Images: base64 data URI only, via { type:'image_url', image_url:{ url } }.
 *   Model id: gemma-4-31b (only image-capable model).
 *
 * NOTE: the API key is read lazily from process.env at call time — never at
 * import, never hardcoded. This module must only ever run server-side
 * (imported from route handlers).
 */
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { ZodType } from 'zod';

export const CEREBRAS_MODEL = 'gemma-4-31b';

let _client: Cerebras | null = null;

function getClient(): Cerebras {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'CEREBRAS_API_KEY is not set. Add it to a git-ignored .env.local as CEREBRAS_API_KEY=...',
    );
  }
  if (!_client) _client = new Cerebras({ apiKey });
  return _client;
}

/** A single image as a base64 data URI, e.g. "data:image/png;base64,AAAA..." */
export interface ImageInput {
  dataUri: string;
}

export interface StructuredCallParams<T> {
  /** Schema name sent to Cerebras strict structured output. */
  schemaName: string;
  /** JSON Schema object (must be strict-compatible: additionalProperties:false). */
  jsonSchema: Record<string, unknown>;
  /** Zod validator used to defensively re-validate the model's JSON. */
  validator: ZodType<T>;
  system: string;
  user: string;
  /** Optional image (situational awareness only). Used from step 2 onward. */
  image?: ImageInput;
  maxCompletionTokens?: number;
  temperature?: number;
}

export interface StructuredCallResult<T> {
  data: T;
  /** True if the first attempt failed Zod and the repair retry was used. */
  repaired: boolean;
  /** Wall-clock ms around the model call(s) — real measured latency. */
  latencyMs: number;
  /** Raw Cerebras usage stats (tokens). */
  usage: unknown;
  /** Raw Cerebras time_info object (server-side timings). */
  timeInfo: unknown;
  /** The raw JSON string the model returned (last good attempt). */
  raw: string;
}

function buildUserContent(user: string, image?: ImageInput) {
  if (!image) return user;
  // Multimodal content array: text + base64 data-URI image (Cerebras format).
  return [
    { type: 'text', text: user },
    { type: 'image_url', image_url: { url: image.dataUri } },
  ];
}

function extractContent(resp: unknown): string {
  const content = (resp as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Unexpected Cerebras response: missing choices[0].message.content string');
  }
  return content;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function tryParseAndValidate<T>(content: string, validator: ZodType<T>): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${(e as Error).message}` };
  }
  const result = validator.safeParse(json);
  if (!result.success) {
    return { ok: false, error: JSON.stringify(result.error.issues) };
  }
  return { ok: true, value: result.data };
}

/**
 * Make one structured Cerebras call with strict mode + Zod validation +
 * exactly one repair retry. Throws if still invalid after the retry.
 */
export async function callCerebrasStructured<T>(
  params: StructuredCallParams<T>,
): Promise<StructuredCallResult<T>> {
  const {
    schemaName,
    jsonSchema,
    validator,
    system,
    user,
    image,
    maxCompletionTokens = 2048,
    temperature = 0.2,
  } = params;

  const client = getClient();

  const response_format = {
    type: 'json_schema' as const,
    json_schema: { name: schemaName, strict: true, schema: jsonSchema },
  };

  const baseMessages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: buildUserContent(user, image) },
  ];

  const commonBody = {
    model: CEREBRAS_MODEL,
    response_format,
    temperature,
    top_p: 1,
    max_completion_tokens: maxCompletionTokens,
  };

  const start = performance.now();

  // ---- attempt 1 ----
  // SDK types don't yet model json_schema response_format / multimodal content,
  // so we cast the request body. Response is re-validated with Zod regardless.
  let resp = await client.chat.completions.create({
    ...commonBody,
    messages: baseMessages,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  let content = extractContent(resp);
  let parsed = tryParseAndValidate(content, validator);
  let repaired = false;

  // ---- one repair retry (only on validation failure) ----
  if (!parsed.ok) {
    repaired = true;
    const repairMessages = [
      ...baseMessages,
      { role: 'assistant' as const, content },
      {
        role: 'user' as const,
        content:
          `Your previous response did not satisfy the required JSON schema.\n` +
          `Validation errors:\n${parsed.error}\n\n` +
          `Return ONLY valid JSON that conforms exactly to the "${schemaName}" schema. No prose, no markdown.`,
      },
    ];
    resp = await client.chat.completions.create({
      ...commonBody,
      messages: repairMessages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    content = extractContent(resp);
    parsed = tryParseAndValidate(content, validator);
  }

  const latencyMs = performance.now() - start;

  if (!parsed.ok) {
    throw new Error(
      `Cerebras structured output failed Zod validation after one repair retry ` +
        `for "${schemaName}": ${parsed.error}\nRaw output: ${content}`,
    );
  }

  return {
    data: parsed.value,
    repaired,
    latencyMs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: (resp as any).usage ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    timeInfo: (resp as any).time_info ?? null,
    raw: content,
  };
}
