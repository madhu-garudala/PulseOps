/**
 * Live Mode stream (plan.md §7.2). Plays the deterministic scripted timeline:
 * for each step it re-runs the SAME one-shot chain (runIncident) on the
 * cumulative evidence and streams the agent events, tagged with the step index.
 *
 * Overlap handling: ticks run SEQUENTIALLY — a tick's chain is awaited to
 * completion before the next tick is scheduled, so a slow tick can never stomp
 * state. Tick STARTS are spaced to `tickMs` (real ~3s cadence) as long as the
 * chain stays under the interval; if it ever runs longer, the next tick simply
 * waits (queue) instead of overlapping. The one-shot path is untouched.
 */
import { loadLiveScript } from '@/lib/live-script';
import { runIncident, type IncidentEvent } from '@/lib/orchestrate';

export const dynamic = 'force-dynamic';
// A full live run spans ~4 ticks (~12s); raise the function limit above the
// default so streaming completes on Vercel.
export const maxDuration = 60;

type LiveLine =
  | { t: 'tick_start'; index: number; label: string; detail: string; totalSteps: number; tickMs: number }
  | { t: 'agent'; index: number; event: IncidentEvent }
  | { t: 'tick_end'; index: number }
  | { t: 'tick_error'; index: number; error: string }
  | { t: 'done' }
  | { t: 'error'; error: string };

export async function GET() {
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: LiveLine) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
      };
      try {
        const { tickMs, steps } = await loadLiveScript();
        for (const step of steps) {
          if (cancelled) break;
          const tickStart = Date.now();
          send({
            t: 'tick_start',
            index: step.index,
            label: step.label,
            detail: step.detail,
            totalSteps: steps.length,
            tickMs,
          });

          // Re-run the one-shot chain on this tick's cumulative evidence.
          // A single failed tick must NOT abort the whole live run — keep going
          // so the timeline stays alive and the last good plan stays on screen.
          try {
            await runIncident(step.input, (event) => send({ t: 'agent', index: step.index, event }));
            send({ t: 'tick_end', index: step.index });
          } catch (tickErr) {
            send({ t: 'tick_error', index: step.index, error: (tickErr as Error).message });
          }

          // Pace the NEXT tick start to tickMs from this tick's start (no overlap).
          if (step.index < steps.length - 1 && !cancelled) {
            const wait = Math.max(0, tickMs - (Date.now() - tickStart));
            await new Promise((r) => setTimeout(r, wait));
          }
        }
        send({ t: 'done' });
      } catch (err) {
        send({ t: 'error', error: (err as Error).message });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
