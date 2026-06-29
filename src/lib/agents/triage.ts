/**
 * 🚨 Triage — plan.md §4.7.
 *
 * Consumes the Observer perception object + the raw pasted text, and produces a
 * severity assessment with a CALIBRATED confidence in its root-cause hypothesis
 * plus any missing evidence. `confidence` and `missing_evidence` drive the
 * code-evaluated Observer callback (§4.4) — so the confidence must be an honest
 * read of how sure Triage is about the ROOT CAUSE, not the severity.
 */
import { callCerebrasStructured, type StructuredCallResult } from '@/lib/cerebras';
import { TriageZod, TriageJsonSchema, type Triage } from '@/lib/schemas';
import type { Observer } from '@/lib/schemas';
import type { IncidentInput } from '@/lib/sample';

const SYSTEM = `You are Triage in an incident command center. Given the Observer's perception
object and the raw evidence, assess the incident. Return JSON for the Triage schema.

Fields:
- severity: reflect the CURRENT customer/business impact given the LATEST evidence, not the
  worst the incident ever was. SEV1 = critical, broad, active impact (e.g. checkout broadly
  failing right now). SEV2 = significant but narrower, unconfirmed, or partially mitigated.
  SEV3/SEV4 = minor or largely recovered. If the latest evidence shows the incident is
  actively recovering (error rates back near baseline, healthy metrics, customers confirming
  success), DOWNGRADE accordingly — an incident in recovery is not SEV1, even if the logs
  still contain the earlier failures.
- primary_hypothesis: your single best guess at the ROOT CAUSE (a short sentence).
- confidence: your calibrated probability (0.0–1.0) that primary_hypothesis is the ACTUAL
  root cause — NOT your confidence in the severity. Be honest and well-calibrated:
  if the symptom is clear but the underlying cause is ambiguous or the evidence sources
  point in different directions, your confidence in the root cause should be modest.
  Reserve confidence above 0.8 for cases where the evidence directly and unambiguously
  pins the root cause.
- missing_evidence: specific pieces of evidence that, if available, would meaningfully
  raise or lower your confidence in the root cause. Empty only if you genuinely need nothing.
- affected_systems: named systems involved, most-implicated FIRST (used downstream).
- likely_category: one of availability | latency | data | security | customer_support | unknown.
- why_now: one sentence on why this is happening now / what changed.

CONFIDENCE CALIBRATION (apply honestly — this is about the ROOT CAUSE, not the symptom):
A visible symptom (e.g. 5xx on the pay path) plus a saturated-looking subsystem on a
dashboard is CORRELATION, not proof of causation. A saturated database can be the cause
OR itself be a victim of the real trigger (a bad deploy, a runaway query, a traffic spike,
a dependency failure). Confirming the causal chain requires direct evidence.

Anchor your confidence to whether that confirming evidence is actually present:
- 0.85–1.0 : the causal chain is directly confirmed by the evidence in hand (e.g. a deploy
             or error message that names the cause).
- 0.5–0.7  : you have a single strong leading hypothesis, but the evidence that would CONFIRM
             causation (deploy/config diffs, slow-query logs proving the DB is the cause not a
             victim, traffic correlation) is NOT present — i.e. items remain in missing_evidence.
- below 0.5 : multiple plausible causes, or the evidence sources point in different directions.

Be consistent: if your missing_evidence list contains items needed to confirm the causal
chain, your confidence MUST sit in the unconfirmed band, not above it. Do not overstate
certainty. A clear symptom is not the same as a confirmed root cause.`;

export async function runTriage(
  input: IncidentInput,
  observer: Observer,
): Promise<StructuredCallResult<Triage>> {
  const user =
    `OBSERVER PERCEPTION (JSON):\n${JSON.stringify(observer, null, 2)}\n\n` +
    `RAW LOGS (text):\n${input.logs}\n\n` +
    `RAW CUSTOMER COMPLAINT (text):\n${input.complaint}`;

  return callCerebrasStructured<Triage>({
    schemaName: 'triage_assessment',
    jsonSchema: TriageJsonSchema as unknown as Record<string, unknown>,
    validator: TriageZod,
    system: SYSTEM,
    user,
    maxCompletionTokens: 700,
  });
}
