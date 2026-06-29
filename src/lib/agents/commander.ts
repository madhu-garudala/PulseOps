/**
 * 🎯 Commander — plan.md §4.7.
 *
 * Consumes the Observer perception + Triage assessment (+ the Observer's callback
 * answer, if the deterministic callback fired) and produces the final incident
 * command plan. The Commander does NOT decide or emit a callback — that is owned
 * by code (§4.4).
 */
import { callCerebrasStructured, type StructuredCallResult } from '@/lib/cerebras';
import {
  CommanderZod,
  CommanderJsonSchema,
  type Commander,
  type Observer,
  type Triage,
  type CallbackAnswer,
} from '@/lib/schemas';

const SYSTEM = `You are the Commander in an incident command center. Given the Observer's
perception, the Triage assessment, and (if present) the Observer's answer to a targeted
follow-up question, produce a crisp, actionable incident command plan as JSON for the
Commander schema.

Guidance:
- incident_title: short, specific.
- situation_summary: 2-3 sentences a responder can act on.
- immediate_actions: concrete first moves, ordered.
- owners: role + task + priority (P0 most urgent). Keep roles generic (e.g. "DB on-call",
  "Payments on-call", "Incident Commander").
- customer_update: a short, honest, customer-facing status (no internal jargon, no blame).
- executive_summary: 2-3 sentences for leadership: impact, current status, next step.
- next_15_minutes: what happens in the next 15 minutes.
- Respect Triage's uncertainty: if the root cause is a strong-but-unconfirmed hypothesis,
  the plan should include the verification steps that would confirm it, not assert it as fact.`;

export async function runCommander(args: {
  observer: Observer;
  triage: Triage;
  callbackAnswer?: CallbackAnswer | null;
}): Promise<StructuredCallResult<Commander>> {
  const { observer, triage, callbackAnswer } = args;

  const callbackBlock = callbackAnswer
    ? `\n\nOBSERVER CALLBACK ANSWER (targeted re-check):\n${JSON.stringify(callbackAnswer, null, 2)}`
    : '';

  const user =
    `OBSERVER PERCEPTION (JSON):\n${JSON.stringify(observer, null, 2)}\n\n` +
    `TRIAGE ASSESSMENT (JSON):\n${JSON.stringify(triage, null, 2)}` +
    callbackBlock;

  return callCerebrasStructured<Commander>({
    schemaName: 'commander_plan',
    jsonSchema: CommanderJsonSchema as unknown as Record<string, unknown>,
    validator: CommanderZod,
    system: SYSTEM,
    user,
    maxCompletionTokens: 1600,
  });
}
