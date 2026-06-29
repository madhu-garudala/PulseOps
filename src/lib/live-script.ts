/**
 * Live Mode scripted evidence timeline (plan.md §7.2) — deterministic, identical
 * every take. Each step is a CUMULATIVE incident input; the same one-shot chain
 * (runIncident) re-runs on it per tick. The arc is engineered like the sample
 * incident so each new piece of evidence HONESTLY changes severity/plan:
 *
 *   t0  complaint + thin logs, no screenshot ......... sparse → ~SEV2, needs evidence
 *   t1  dashboard screenshot + full logs ............. DB melt visible → escalates SEV1
 *   t2  rollback / pool-raise mitigation logged ...... plan shifts to verify mitigation
 *   t3  recovery logs + recovery screenshot .......... recovered → de-escalates
 *
 * This layers ON TOP of the one-shot path; it does not modify it.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { IncidentInput } from '@/lib/sample';

const SAMPLE_DIR = path.join(process.cwd(), 'data', 'sample-incident');

/** 3s tick — comfortably above the measured ~2.2–2.4s chain time. */
export const LIVE_TICK_MS = 3000;

export interface LiveStep {
  index: number;
  /** Short label for the timeline rail. */
  label: string;
  /** One line describing what just arrived. */
  detail: string;
  /** Cumulative evidence the chain runs on at this tick. */
  input: IncidentInput;
}

// t0 — an early, vague report (honestly SEV2/SEV3: limited, unconfirmed impact).
// The full escalation complaint arrives at t1 with the dashboard.
const COMPLAINT_INITIAL = `[First report — #incident-bridge, 14:33]
A couple of customers mentioned checkout felt slow, and one said a payment didn't
go through on the first try but worked on retry. Could be a blip — no clear pattern
yet, low volume so far. Keeping an eye on it.`;

const LOGS_INITIAL = `# api-gateway — first reports (text feed, UTC-7)
14:32:04  api-gateway   WARN   POST /v1/checkout/pay  upstream latency 1.8s
14:32:33  api-gateway   ERROR  POST /v1/checkout/pay  502  upstream request timeout
14:33:09  api-gateway   ERROR  POST /v1/checkout/pay  500  internal error
# Sparse so far — a handful of checkout failures just starting.`;

const LOGS_FULL = `# api-gateway + payments-service — last ~12 min (text feed, UTC-7)
14:32:04  api-gateway   WARN   POST /v1/checkout/pay  upstream latency 1.8s
14:32:33  api-gateway   ERROR  POST /v1/checkout/pay  502  upstream request timeout
14:32:51  payments-svc  ERROR  charge failed: upstream timeout after 2000ms
14:33:09  api-gateway   ERROR  POST /v1/checkout/pay  500  internal error
14:33:10  payments-svc  ERROR  charge failed: context deadline exceeded
14:34:05  payments-svc  ERROR  circuit breaker OPEN (downstream dependency)
14:34:39  api-gateway   ERROR  POST /v1/checkout/pay  503  payments unavailable
14:35:12  payments-svc  ERROR  charge failed: could not acquire resource (timeout)
14:36:00  api-gateway   WARN   5xx rate 7.0% (1m), p99 3.1s, retries climbing
# Read path (GET /products, /cart) still mostly 200 — failures on the pay write path.`;

const LOGS_MITIGATION = `
14:42:10  ops           INFO   mitigation: rollback of 14:05 deploy initiated
14:42:25  ops           INFO   mitigation: pg-orders-01 connection pool raised 200 -> 400
14:43:02  payments-svc  INFO   circuit breaker HALF_OPEN (probing downstream)`;

const LOGS_RECOVERY = `
14:46:11  payments-svc  INFO   circuit breaker CLOSED (downstream healthy)
14:47:30  api-gateway   INFO   5xx rate 0.4% (1m), p99 180ms — recovered
14:48:00  payments-svc  INFO   POST /v1/checkout/pay  200  168ms`;

const COMPLAINT_RECOVERY_NOTE = `

[Update, 14:48] On-call: enterprise customers confirm checkout is succeeding again;
ticket volume dropping. Monitoring for stability before all-clear.`;

export async function loadLiveScript(): Promise<{ tickMs: number; steps: LiveStep[] }> {
  const [complaint, degradedPng, recoveringPng] = await Promise.all([
    fs.readFile(path.join(SAMPLE_DIR, 'complaint.txt'), 'utf8'),
    fs.readFile(path.join(SAMPLE_DIR, 'screenshot.png')),
    fs.readFile(path.join(SAMPLE_DIR, 'screenshot_recovering.png')),
  ]);
  const degradedUri = `data:image/png;base64,${degradedPng.toString('base64')}`;
  const recoveringUri = `data:image/png;base64,${recoveringPng.toString('base64')}`;

  const steps: LiveStep[] = [
    {
      index: 0,
      label: 'First report',
      detail: 'Early vague report — slow checkout, one failed payment. Sparse logs, no dashboard.',
      input: { complaint: COMPLAINT_INITIAL, logs: LOGS_INITIAL, screenshotDataUri: undefined },
    },
    {
      index: 1,
      label: 'Escalation + dashboard',
      detail: 'Enterprise escalation (1-in-3 failing) + data-tier dashboard land — DB saturation visible.',
      input: { complaint, logs: LOGS_FULL, screenshotDataUri: degradedUri },
    },
    {
      index: 2,
      label: 'Mitigation underway',
      detail: 'Rollback initiated and connection pool raised 200→400.',
      input: {
        complaint,
        logs: LOGS_FULL + LOGS_MITIGATION,
        screenshotDataUri: degradedUri,
      },
    },
    {
      index: 3,
      label: 'Recovery detected',
      detail: 'Error rate 0.4%, latency back to baseline — dashboard recovering.',
      input: {
        complaint: complaint + COMPLAINT_RECOVERY_NOTE,
        logs: LOGS_FULL + LOGS_MITIGATION + LOGS_RECOVERY,
        screenshotDataUri: recoveringUri,
      },
    },
  ];

  return { tickMs: LIVE_TICK_MS, steps };
}
