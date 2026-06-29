/**
 * Latency baseline (plan.md §6) — built LAST, honest, never hardcoded.
 *
 * ONE identical representative multimodal call is sent to BOTH providers:
 *   • Cerebras  gemma-4-31b  (our primary)
 *   • OpenAI    gpt-4o       (fair non-reasoning flagship peer)
 *
 * Same system + user prompt, same dashboard image, same max tokens, same
 * temperature — the ONLY variable is inference speed. We do NOT rebuild the
 * 3-agent chain on OpenAI (§6). Both calls are streamed so we measure, live and
 * apples-to-apples: TTFT (time to first token), wall-clock total, tokens/sec.
 *
 * Every number comes from a live call each invocation. Nothing is cached,
 * estimated, simulated, or hardcoded. If a provider call fails, we surface the
 * error rather than fabricate a number.
 */
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import OpenAI from 'openai';

export const BASELINE_CEREBRAS_MODEL = 'gemma-4-31b';
export const BASELINE_OPENAI_MODEL = 'gpt-4o';

const MAX_TOKENS = 400;
const TEMPERATURE = 0.2;

const SYSTEM = 'You are an incident triage assistant. Be concise and concrete.';
const TASK =
  'Given the logs, the customer complaint, and the attached dashboard screenshot, ' +
  'respond in 3-4 sentences: the severity (SEV1-SEV4), the single most likely root ' +
  'cause, and the first action to take.';

export interface BaselineMessageInput {
  logs: string;
  complaint: string;
  screenshotDataUri: string;
}

/** Identical message array for BOTH providers (both are OpenAI-shaped). */
function buildMessages(input: BaselineMessageInput) {
  const userText = `LOGS:\n${input.logs}\n\nCUSTOMER COMPLAINT:\n${input.complaint}\n\n${TASK}`;
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: input.screenshotDataUri } },
      ],
    },
  ];
}

export interface BaselineResult {
  provider: 'cerebras' | 'openai';
  model: string;
  /** Time to first content token (ms). Null if no tokens streamed. */
  ttftMs: number | null;
  /** Wall-clock from request to stream end (ms). */
  totalMs: number;
  /** Completion tokens generated (from usage when available). */
  outputTokens: number | null;
  /** Output tokens / generation time — throughput. Null if not derivable. */
  tokensPerSec: number | null;
  /** First ~160 chars of the response, for transparency (not the headline). */
  preview: string;
}

let _cerebras: Cerebras | null = null;
function cerebras(): Cerebras {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error('CEREBRAS_API_KEY is not set');
  if (!_cerebras) _cerebras = new Cerebras({ apiKey });
  return _cerebras;
}

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  if (!_openai) _openai = new OpenAI({ apiKey });
  return _openai;
}

function finalize(
  provider: 'cerebras' | 'openai',
  model: string,
  ttftMs: number | null,
  totalMs: number,
  outputTokens: number | null,
  text: string,
): BaselineResult {
  const genMs = ttftMs != null ? totalMs - ttftMs : totalMs;
  const tokensPerSec =
    outputTokens && genMs > 0 ? Math.round((outputTokens / genMs) * 1000) : null;
  return {
    provider,
    model,
    ttftMs: ttftMs != null ? Math.round(ttftMs) : null,
    totalMs: Math.round(totalMs),
    outputTokens,
    tokensPerSec,
    preview: text.slice(0, 160),
  };
}

export async function runBaselineCerebras(input: BaselineMessageInput): Promise<BaselineResult> {
  const client = cerebras();
  const messages = buildMessages(input);
  const start = performance.now();
  let ttft: number | null = null;
  let outputTokens: number | null = null;
  let text = '';

  const stream = await client.chat.completions.create({
    model: BASELINE_CEREBRAS_MODEL,
    messages,
    stream: true,
    max_completion_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    top_p: 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of stream as any) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) {
      if (ttft === null) ttft = performance.now() - start;
      text += delta;
    }
    if (chunk?.usage?.completion_tokens != null) outputTokens = chunk.usage.completion_tokens;
  }

  return finalize('cerebras', BASELINE_CEREBRAS_MODEL, ttft, performance.now() - start, outputTokens, text);
}

export async function runBaselineOpenAI(input: BaselineMessageInput): Promise<BaselineResult> {
  const client = openai();
  const messages = buildMessages(input);
  const start = performance.now();
  let ttft: number | null = null;
  let outputTokens: number | null = null;
  let text = '';

  const stream = await client.chat.completions.create({
    model: BASELINE_OPENAI_MODEL,
    messages,
    stream: true,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    stream_options: { include_usage: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of stream as any) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) {
      if (ttft === null) ttft = performance.now() - start;
      text += delta;
    }
    if (chunk?.usage?.completion_tokens != null) outputTokens = chunk.usage.completion_tokens;
  }

  return finalize('openai', BASELINE_OPENAI_MODEL, ttft, performance.now() - start, outputTokens, text);
}
