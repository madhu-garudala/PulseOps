/**
 * Streams the one-shot incident chain as NDJSON, one line per phase event
 * (input, observer, triage, callback, commander, done). The UI reveals each
 * agent live as its line arrives. Always runs live against Cerebras.
 */
import { loadSampleIncident } from '@/lib/sample';
import { runIncident, type IncidentEvent } from '@/lib/orchestrate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: IncidentEvent | { type: 'error'; error: string }) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      try {
        const incident = await loadSampleIncident();
        await runIncident(incident, send);
      } catch (err) {
        send({ type: 'error', error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
