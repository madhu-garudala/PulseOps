/**
 * 🛰️ Observer (the Perceiver) — plan.md §4.7.
 *
 * Consumes screenshot (image, situational awareness only), logs (text) and
 * complaint (text), and merges them into one perception object. It PERCEIVES,
 * it does not diagnose severity or prescribe actions (that's Triage/Commander).
 */
import { callCerebrasStructured, type StructuredCallResult } from '@/lib/cerebras';
import {
  ObserverZod,
  ObserverJsonSchema,
  CallbackAnswerZod,
  CallbackAnswerJsonSchema,
  type Observer,
  type CallbackAnswer,
} from '@/lib/schemas';
import type { IncidentInput } from '@/lib/sample';

const SYSTEM = `You are the Observer in an incident command center: a careful perception layer.
Your job is to report WHAT IS OBSERVED across three evidence sources, NOT to decide
severity or root cause. Be concrete and factual.

Evidence sources:
- A dashboard screenshot: situational awareness only (charts, red/amber indicators,
  saturation, topology). Do NOT try to read tiny text or stack traces from it.
- Logs (text).
- A customer complaint / incident note (text).

Return JSON for the Observer schema:
- observations: concrete things you observe across the evidence (mix of log + image + complaint).
- visible_systems: named systems/components that appear (from any source).
- possible_signals: candidate signals worth noting (e.g. "DB connection saturation",
  "elevated 5xx on pay path"). These are signals, not conclusions.
- uncertainties: things that are ambiguous or where sources may point in different directions.
- image_summary: one sentence on what the screenshot conveys at a glance.

Report tensions honestly in 'uncertainties' if the text and the screenshot seem to point
at different things. Do not invent specifics that are not supported by the evidence.`;

export async function runObserver(input: IncidentInput): Promise<StructuredCallResult<Observer>> {
  const user =
    `LOGS (text):\n${input.logs}\n\n` +
    `CUSTOMER COMPLAINT / INCIDENT NOTE (text):\n${input.complaint}\n\n` +
    `The attached screenshot is the operations dashboard (situational awareness only).`;

  return callCerebrasStructured<Observer>({
    schemaName: 'observer_perception',
    jsonSchema: ObserverJsonSchema as unknown as Record<string, unknown>,
    validator: ObserverZod,
    system: SYSTEM,
    user,
    image: input.screenshotDataUri ? { dataUri: input.screenshotDataUri } : undefined,
    maxCompletionTokens: 900,
  });
}

/**
 * Focused callback answer (§4.4): the Observer re-checks the SCREENSHOT to answer
 * ONE code-generated question. Deliberately a tiny prompt — full incident context
 * is NOT re-sent; only the screenshot + the single question.
 */
export async function runObserverCallback(
  question: string,
  screenshotDataUri?: string,
): Promise<StructuredCallResult<CallbackAnswer>> {
  return callCerebrasStructured<CallbackAnswer>({
    schemaName: 'observer_callback_answer',
    jsonSchema: CallbackAnswerJsonSchema as unknown as Record<string, unknown>,
    validator: CallbackAnswerZod,
    system:
      'You are the Observer. Answer ONLY the single question asked, by looking at the ' +
      'attached dashboard screenshot. One concise sentence. Set confirmed=true only if the ' +
      'screenshot visibly supports it.',
    user: question,
    image: screenshotDataUri ? { dataUri: screenshotDataUri } : undefined,
    maxCompletionTokens: 200,
  });
}
