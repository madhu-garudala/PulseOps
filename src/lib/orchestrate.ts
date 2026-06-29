/**
 * Incident orchestration (plan.md §4.2) — plain TS, no LangGraph.
 *
 *   Observer -> Triage -> [code-evaluated callback? -> Observer answer] -> Commander
 *
 * The same chain is the engine for the one-shot floor AND (later) each Live Mode
 * tick. Latency is measured per-agent and as a total (§6) from real values.
 * Critic is intentionally NOT wired (§4.6).
 *
 * An optional onEvent callback emits each phase as it completes so the UI can
 * reveal agents live (streamed). The chain still returns the full result too.
 */
import type { IncidentInput } from '@/lib/sample';
import { runObserver, runObserverCallback } from '@/lib/agents/observer';
import { runTriage } from '@/lib/agents/triage';
import { runCommander } from '@/lib/agents/commander';
import { needsCallback, buildCallbackQuestion } from '@/lib/callback';
import type { Observer, Triage, Commander, CallbackAnswer } from '@/lib/schemas';

export interface CallbackTrace {
  fired: boolean;
  question?: string;
  answer?: CallbackAnswer;
  latencyMs?: number;
}

export interface AgentLatencies {
  observerMs: number;
  triageMs: number;
  callbackMs: number; // 0 when the callback did not fire
  commanderMs: number;
  totalMs: number;
}

export interface IncidentResult {
  observer: Observer;
  triage: Triage;
  callback: CallbackTrace;
  commander: Commander;
  latencies: AgentLatencies;
  imageTokens: number | null;
  anyRepaired: boolean;
}

/** Streamed phase events (one per agent step). */
export type IncidentEvent =
  | { type: 'input'; logs: string; complaint: string; screenshotDataUri?: string }
  | { type: 'observer'; data: Observer; latencyMs: number }
  | { type: 'triage'; data: Triage; latencyMs: number }
  | { type: 'callback'; fired: boolean; question?: string; answer?: CallbackAnswer; latencyMs?: number }
  | { type: 'commander'; data: Commander; latencyMs: number }
  | { type: 'done'; latencies: AgentLatencies; imageTokens: number | null; anyRepaired: boolean };

export async function runIncident(
  input: IncidentInput,
  onEvent?: (e: IncidentEvent) => void,
): Promise<IncidentResult> {
  const emit = (e: IncidentEvent) => onEvent?.(e);
  const chainStart = performance.now();

  emit({
    type: 'input',
    logs: input.logs,
    complaint: input.complaint,
    screenshotDataUri: input.screenshotDataUri,
  });

  // 1) Observer perceives all evidence into one perception object.
  const observer = await runObserver(input);
  emit({ type: 'observer', data: observer.data, latencyMs: observer.latencyMs });

  // 2) Triage assesses severity + calibrated root-cause confidence.
  const triage = await runTriage(input, observer.data);
  emit({ type: 'triage', data: triage.data, latencyMs: triage.latencyMs });

  // 3) Deterministic callback — trigger AND question are pure code (§4.4).
  const callback: CallbackTrace = { fired: false };
  let callbackAnswer: CallbackAnswer | null = null;
  let callbackRepaired = false;
  if (needsCallback(triage.data)) {
    const question = buildCallbackQuestion(triage.data);
    const ans = await runObserverCallback(question, input.screenshotDataUri);
    callbackAnswer = ans.data;
    callbackRepaired = ans.repaired;
    callback.fired = true;
    callback.question = question;
    callback.answer = ans.data;
    callback.latencyMs = ans.latencyMs;
  }
  emit({
    type: 'callback',
    fired: callback.fired,
    question: callback.question,
    answer: callback.answer,
    latencyMs: callback.latencyMs,
  });

  // 4) Commander finalizes the plan (with the callback answer if one occurred).
  const commander = await runCommander({
    observer: observer.data,
    triage: triage.data,
    callbackAnswer,
  });
  emit({ type: 'commander', data: commander.data, latencyMs: commander.latencyMs });

  const totalMs = performance.now() - chainStart;
  const latencies: AgentLatencies = {
    observerMs: observer.latencyMs,
    triageMs: triage.latencyMs,
    callbackMs: callback.latencyMs ?? 0,
    commanderMs: commander.latencyMs,
    totalMs,
  };
  const imageTokens =
    (observer.usage as { image_tokens?: number } | null)?.image_tokens ?? null;
  const anyRepaired =
    observer.repaired || triage.repaired || commander.repaired || callbackRepaired;

  emit({ type: 'done', latencies, imageTokens, anyRepaired });

  return { observer: observer.data, triage: triage.data, callback, commander: commander.data, latencies, imageTokens, anyRepaired };
}
