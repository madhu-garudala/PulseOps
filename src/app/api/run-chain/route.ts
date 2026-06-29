/**
 * Runs the full one-shot incident chain (Observer -> Triage -> code callback ->
 * Commander) on the sample incident and returns every agent's raw output plus
 * per-agent + total latency. This is the server side of the Phase A floor.
 */
import { loadSampleIncident } from '@/lib/sample';
import { runIncident } from '@/lib/orchestrate';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const incident = await loadSampleIncident();
    const result = await runIncident(incident);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
