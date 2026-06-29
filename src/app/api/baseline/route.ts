/**
 * Latency baseline endpoint (§6). Runs ONE identical multimodal call on each
 * provider, SEQUENTIALLY (so they don't contend and skew each other's timing),
 * and returns the live measured numbers for both. Never cached/hardcoded.
 *
 * If a provider call fails, its error is returned (the UI shows "unavailable")
 * rather than fabricating a number — an honest "no baseline" over a fake one.
 */
import { loadSampleIncident } from '@/lib/sample';
import {
  runBaselineCerebras,
  runBaselineOpenAI,
  type BaselineResult,
} from '@/lib/baseline';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Side = { ok: true; result: BaselineResult } | { ok: false; error: string };

async function safe(run: () => Promise<BaselineResult>): Promise<Side> {
  try {
    return { ok: true, result: await run() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function GET() {
  try {
    const incident = await loadSampleIncident();
    if (!incident.screenshotDataUri) {
      return Response.json({ ok: false, error: 'Sample incident has no screenshot' }, { status: 500 });
    }
    const input = {
      logs: incident.logs,
      complaint: incident.complaint,
      screenshotDataUri: incident.screenshotDataUri,
    };

    // Sequential: Cerebras first, then OpenAI — no cross-contention.
    const cerebras = await safe(() => runBaselineCerebras(input));
    const openai = await safe(() => runBaselineOpenAI(input));

    let speedup: number | null = null;
    if (cerebras.ok && openai.ok && cerebras.result.totalMs > 0) {
      speedup = Math.round((openai.result.totalMs / cerebras.result.totalMs) * 10) / 10;
    }

    return Response.json({ ok: true, cerebras, openai, speedup });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
