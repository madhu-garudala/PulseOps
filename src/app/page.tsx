'use client';

/**
 * PulseOps — the one beautiful moment (plan.md §7.1), one-shot floor.
 *
 * Left: incoming evidence. Center: agent cards revealing findings as staggered
 * checked bullets (never a "Thinking…" spinner, §4.1) + the visible callback
 * exchange. Right: the command plan snapping into place. Bottom: real per-agent
 * + total latency (§6). UI status is human, never a confidence decimal (§7.3).
 *
 * Content is 100% real (streamed from /api/incident/stream); only the reveal
 * pacing is presentation, so the motion reads on video even when Cerebras
 * returns near-instantly.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Observer, Triage, Commander, CallbackAnswer } from '@/lib/schemas';
import type { IncidentEvent } from '@/lib/orchestrate';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Ev<K extends IncidentEvent['type']> = Extract<IncidentEvent, { type: K }>;
type CardState = 'idle' | 'active' | 'done';

const SEV_CLASS: Record<string, string> = {
  SEV1: 'bg-red-600 text-white',
  SEV2: 'bg-orange-500 text-white',
  SEV3: 'bg-yellow-500 text-black',
  SEV4: 'bg-zinc-500 text-white',
};
const PRIORITY_CLASS: Record<string, string> = {
  P0: 'bg-red-600 text-white',
  P1: 'bg-orange-500 text-white',
  P2: 'bg-zinc-600 text-white',
};

function triageStatus(t: Triage): { label: string; tone: 'warn' | 'ok' } {
  if (t.confidence < 0.75) return { label: 'Evidence conflict detected', tone: 'warn' };
  if (t.missing_evidence.length > 0) return { label: 'Needs more evidence', tone: 'warn' };
  return { label: 'High confidence', tone: 'ok' };
}

function observerBullets(o: Observer): string[] {
  return (o.possible_signals.length ? o.possible_signals : o.observations).slice(0, 6);
}
function triageBullets(t: Triage): string[] {
  const items = [`Severity ${t.severity} · ${t.likely_category}`, t.primary_hypothesis];
  if (t.missing_evidence.length > 0) items.push(`Open question: ${t.missing_evidence[0]}`);
  return items;
}

function CheckBullet({ text }: { text: string }) {
  return (
    <li className="flex gap-2 items-start animate-in fade-in slide-in-from-left-2 duration-300">
      <span className="text-emerald-500 mt-[2px] shrink-0">✓</span>
      <span className="text-foreground/90">{text}</span>
    </li>
  );
}

function AgentCard(props: {
  icon: string;
  name: string;
  state: CardState;
  status?: React.ReactNode;
  bullets: string[];
}) {
  const { icon, name, state, status, bullets } = props;
  return (
    <Card
      className={`transition-all duration-300 ${
        state === 'active' ? 'ring-2 ring-primary/50 shadow-lg' : ''
      } ${state === 'idle' ? 'opacity-50' : 'opacity-100'}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-base">{icon}</span>
          {name}
          {state === 'active' && (
            <span className="ml-auto flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {status}
        <ul className="space-y-1.5 text-sm mt-2 min-h-[1rem]">
          {bullets.map((b, i) => (
            <CheckBullet key={i} text={b} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const [inputs, setInputs] = useState<{ logs: string; complaint: string; screenshot?: string } | null>(
    null,
  );

  const [observer, setObserver] = useState<Observer | null>(null);
  const [obsBullets, setObsBullets] = useState<string[]>([]);
  const [obsState, setObsState] = useState<CardState>('idle');

  const [triage, setTriage] = useState<Triage | null>(null);
  const [triBullets, setTriBullets] = useState<string[]>([]);
  const [triState, setTriState] = useState<CardState>('idle');

  const [callback, setCallback] = useState<{
    fired: boolean;
    question?: string;
    answer?: CallbackAnswer;
    showAnswer: boolean;
  } | null>(null);

  const [commander, setCommander] = useState<Commander | null>(null);
  const [planIn, setPlanIn] = useState(false);

  const [perAgent, setPerAgent] = useState<{
    observer?: number;
    triage?: number;
    callback?: number;
    commander?: number;
  }>({});
  const [totals, setTotals] = useState<{ totalMs: number; imageTokens: number | null } | null>(null);

  async function run() {
    setPhase('running');
    setError(null);
    setInputs(null);
    setObserver(null);
    setObsBullets([]);
    setObsState('idle');
    setTriage(null);
    setTriBullets([]);
    setTriState('idle');
    setCallback(null);
    setCommander(null);
    setPlanIn(false);
    setPerAgent({});
    setTotals(null);

    const d = {
      input: deferred<Ev<'input'>>(),
      observer: deferred<Ev<'observer'>>(),
      triage: deferred<Ev<'triage'>>(),
      callback: deferred<Ev<'callback'>>(),
      commander: deferred<Ev<'commander'>>(),
      done: deferred<Ev<'done'>>(),
    };

    // Network reader: resolve deferreds as NDJSON lines arrive.
    (async () => {
      try {
        const res = await fetch('/api/incident/stream');
        if (!res.body) throw new Error('No response stream');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as IncidentEvent | { type: 'error'; error: string };
            if (ev.type === 'error') setError(ev.error);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            else (d as any)[ev.type]?.resolve(ev);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();

    // Presentation director: real content, paced reveal so the motion reads.
    try {
      const inp = await d.input.promise;
      setInputs({ logs: inp.logs, complaint: inp.complaint, screenshot: inp.screenshotDataUri });
      await sleep(350);

      setObsState('active');
      const obs = await d.observer.promise;
      setObserver(obs.data);
      setPerAgent((p) => ({ ...p, observer: obs.latencyMs }));
      const oItems = observerBullets(obs.data);
      for (let i = 0; i < oItems.length; i++) {
        setObsBullets(oItems.slice(0, i + 1));
        await sleep(240);
      }
      setObsState('done');
      await sleep(220);

      setTriState('active');
      const tri = await d.triage.promise;
      setTriage(tri.data);
      setPerAgent((p) => ({ ...p, triage: tri.latencyMs }));
      const tItems = triageBullets(tri.data);
      for (let i = 0; i < tItems.length; i++) {
        setTriBullets(tItems.slice(0, i + 1));
        await sleep(260);
      }
      setTriState('done');
      await sleep(220);

      const cb = await d.callback.promise;
      if (cb.fired) {
        setCallback({ fired: true, question: cb.question, answer: cb.answer, showAnswer: false });
        if (cb.latencyMs) setPerAgent((p) => ({ ...p, callback: cb.latencyMs }));
        await sleep(1100); // let the question read
        setCallback({ fired: true, question: cb.question, answer: cb.answer, showAnswer: true });
        await sleep(700);
      } else {
        setCallback({ fired: false, showAnswer: false });
      }

      const cmd = await d.commander.promise;
      setPerAgent((p) => ({ ...p, commander: cmd.latencyMs }));
      await sleep(250);
      setCommander(cmd.data);
      await sleep(30);
      setPlanIn(true); // plan snaps into place

      const done = await d.done.promise;
      setTotals({ totalMs: done.latencies.totalMs, imageTokens: done.imageTokens });
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('done');
    }
  }

  const sev = triage?.severity;
  const status = triage ? triageStatus(triage) : null;

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">PulseOps</h1>
          <p className="text-xs text-muted-foreground">
            Real-time AI incident command center · Cerebras × Gemma 4 31B
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden md:block text-xs text-muted-foreground">
            Incident&nbsp;starts → Evidence → Agents&nbsp;react → Plan → Customer&nbsp;update
          </span>
          <Button onClick={run} disabled={phase === 'running'}>
            {phase === 'running' ? 'Running…' : '▶ Load Demo Incident'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Main 3-column stage */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_380px] gap-4 p-4 sm:p-6">
        {/* LEFT — evidence */}
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Incoming evidence
          </h2>
          <Card>
            <CardContent className="p-3 space-y-3">
              {inputs?.screenshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={inputs.screenshot}
                  alt="incident dashboard screenshot"
                  className="w-full rounded-md border animate-in fade-in duration-500"
                />
              ) : (
                <div className="aspect-[2/1] w-full rounded-md border border-dashed grid place-items-center text-xs text-muted-foreground">
                  dashboard screenshot
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Logs
                </p>
                <pre className="text-[10px] leading-snug max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 whitespace-pre-wrap">
                  {inputs?.logs ?? '—'}
                </pre>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Customer complaint
                </p>
                <p className="text-[11px] leading-snug max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 whitespace-pre-wrap">
                  {inputs?.complaint ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CENTER — agents */}
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Agents
          </h2>

          {phase === 'idle' ? (
            <Card className="grid place-items-center py-16 text-center">
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Click <span className="font-medium text-foreground">▶ Load Demo Incident</span> to
                  watch the command center react.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <AgentCard
                icon="🛰️"
                name="Observer"
                state={obsState}
                bullets={obsBullets}
                status={
                  obsState !== 'idle' && observer ? (
                    <p className="text-xs text-muted-foreground italic">{observer.image_summary}</p>
                  ) : null
                }
              />

              <AgentCard
                icon="🚨"
                name="Triage"
                state={triState}
                bullets={triBullets}
                status={
                  triage ? (
                    <div className="flex items-center gap-2">
                      <Badge className={SEV_CLASS[triage.severity]}>{triage.severity}</Badge>
                      <Badge
                        variant="outline"
                        className={
                          status?.tone === 'warn'
                            ? 'border-orange-500/50 text-orange-400'
                            : 'border-emerald-500/50 text-emerald-400'
                        }
                      >
                        {status?.label}
                      </Badge>
                    </div>
                  ) : null
                }
              />

              {/* Callback exchange */}
              {callback?.fired && (
                <Card className="border-primary/40 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <CardContent className="p-3 space-y-2 text-sm">
                    <div className="flex gap-2">
                      <span className="shrink-0">🎯</span>
                      <p>
                        <span className="text-muted-foreground">Commander → Observer:</span>{' '}
                        {callback.question}
                      </p>
                    </div>
                    {callback.showAnswer && callback.answer && (
                      <div className="flex gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
                        <span className="shrink-0">🛰️</span>
                        <p>
                          <span className="text-muted-foreground">Observer:</span>{' '}
                          {callback.answer.answer}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </section>

        {/* RIGHT — command plan */}
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Incident command plan
          </h2>
          {commander ? (
            <Card
              className={`transition-all duration-500 ${
                planIn ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-[0.98]'
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  {sev && <Badge className={SEV_CLASS[sev]}>{sev}</Badge>}
                  <CardTitle className="text-base">{commander.incident_title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm max-h-[70vh] overflow-auto">
                <p className="text-foreground/90">{commander.situation_summary}</p>

                <PlanBlock title="Immediate actions">
                  <ol className="list-decimal ml-4 space-y-1">
                    {commander.immediate_actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ol>
                </PlanBlock>

                <PlanBlock title="Owners">
                  <ul className="space-y-1">
                    {commander.owners.map((o, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge className={`${PRIORITY_CLASS[o.priority]} shrink-0`}>{o.priority}</Badge>
                        <span>
                          <span className="font-medium">{o.role}:</span> {o.task}
                        </span>
                      </li>
                    ))}
                  </ul>
                </PlanBlock>

                <PlanBlock title="Customer update">
                  <p className="rounded-md border bg-muted/40 p-2 italic">{commander.customer_update}</p>
                </PlanBlock>

                <PlanBlock title="Executive summary">
                  <p>{commander.executive_summary}</p>
                </PlanBlock>

                <PlanBlock title="Next 15 minutes">
                  <ul className="list-disc ml-4 space-y-1">
                    {commander.next_15_minutes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </PlanBlock>
              </CardContent>
            </Card>
          ) : (
            <Card className="grid place-items-center py-16 text-center">
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  The command plan appears here once the agents finish.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </main>

      {/* BOTTOM — real latency strip (§6) */}
      <footer className="border-t px-6 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="text-muted-foreground uppercase tracking-wider">Latency (live)</span>
        <Lat label="🛰️ Observer" ms={perAgent.observer} />
        <Lat label="🚨 Triage" ms={perAgent.triage} />
        <Lat label="↔️ Callback" ms={perAgent.callback} />
        <Lat label="🎯 Commander" ms={perAgent.commander} />
        <span className="text-border">|</span>
        <span className="font-semibold">
          Total chain:{' '}
          {totals ? `${(totals.totalMs / 1000).toFixed(2)}s` : <span className="text-muted-foreground">—</span>}
        </span>
        {totals?.imageTokens != null && (
          <span className="text-muted-foreground">· {totals.imageTokens} image tokens</span>
        )}
      </footer>
    </div>
  );
}

function PlanBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </p>
      {children}
    </div>
  );
}

function Lat({ label, ms }: { label: string; ms?: number }) {
  return (
    <span className="tabular-nums">
      {label}:{' '}
      {ms != null ? (
        <span className="font-medium text-foreground">{Math.round(ms)}ms</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </span>
  );
}
