/**
 * Deterministic Observer callback (plan.md §4.4).
 *
 * BOTH the trigger and the question are generated in CODE, never by a model —
 * this is the signature multi-agent moment and must not depend on a model
 * deciding to ask or wording the question. The Commander emits NO callback JSON.
 */
import type { Triage } from '@/lib/schemas';

/** Trigger: code reads Triage output. */
export function needsCallback(triage: Triage): boolean {
  return triage.confidence < 0.75 || triage.missing_evidence.length > 0;
}

/**
 * Question: code fills a template, injecting a real Triage value
 * (affected_systems[0], a system NAME) so it reads as dynamic, not canned.
 */
export function buildCallbackQuestion(triage: Triage): string {
  const suspectedSystem = triage.affected_systems[0] ?? 'the API layer';
  return (
    `Re-check the screenshot. Is ${suspectedSystem} showing signs of saturation, ` +
    `degradation, or dependency failure?`
  );
}
