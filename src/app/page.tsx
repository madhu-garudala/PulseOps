'use client';

/**
 * PulseOps — the one beautiful moment (§7.1) + Live Mode (§7.2).
 *
 * Two entry points share the SAME display surface:
 *   • "Load Demo Incident"      — one-shot floor: paced staggered reveal (run()).
 *   • "Simulate Live Incident"  — Live Mode: scripted evidence timeline re-runs
 *                                 the chain each tick; severity/plan/customer
 *                                 update/timeline mutate IN PLACE (runLive()).
 *
 * The one-shot path is unchanged by Live Mode. Content is always real (streamed);
 * only the one-shot reveal pacing is presentation. UI status is human, never a
 * confidence decimal (§7.3).
 */
import { useRef, useState } from 'react';
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
type Mode = 'idle' | 'oneshot' | 'live';

interface LiveStepUI {
  index: number;
  label: string;
  detail: string;
  status: 'active' | 'done';
  severity?: string;
  warn?: boolean;
}

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
            <CheckBullet key={`${b}-${i}`} text={b} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [mode, setMode] = useState<Mode>('idle');
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
  const [planHighlight, setPlanHighlight] = useState(false);

  const [perAgent, setPerAgent] = useState<{
    observer?: number;
    triage?: number;
    callback?: number;
    commander?: number;
  }>({});
  const [totals, setTotals] = useState<{ totalMs: number; imageTokens: number | null } | null>(null);

  // Live Mode timeline rail
  const [liveSteps, setLiveSteps] = useState<LiveStepUI[]>([]);
  const [liveEvidence, setLiveEvidence] = useState<{ label: string; detail: string } | null>(null);
  const planHlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetDisplay() {
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
    setPlanHighlight(false);
    setPerAgent({});
    setTotals(null);
    setLiveSteps([]);
    setLiveEvidence(null);
  }

  function pulsePlan() {
    setPlanHighlight(true);
    if (planHlTimer.current) clearTimeout(planHlTimer.current);
    planHlTimer.current = setTimeout(() => setPlanHighlight(false), 700);
  }

  // ---------- ONE-SHOT (unchanged floor behaviour) ----------
  async function run() {
    setPhase('running');
    setMode('oneshot');
    resetDisplay();

    const d = {
      input: deferred<Ev<'input'>>(),
      observer: deferred<Ev<'observer'>>(),
      triage: deferred<Ev<'triage'>>(),
      callback: deferred<Ev<'callback'>>(),
      commander: deferred<Ev<'commander'>>(),
      done: deferred<Ev<'done'>>(),
    };

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
        await sleep(1100);
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
      setPlanIn(true);

      const done = await d.done.promise;
      setTotals({ totalMs: done.latencies.totalMs, imageTokens: done.imageTokens });
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('done');
    }
  }

  // ---------- LIVE MODE (layered on top) ----------
  function handleLiveAgent(index: number, ev: IncidentEvent) {
    switch (ev.type) {
      case 'input':
        setInputs({ logs: ev.logs, complaint: ev.complaint, screenshot: ev.screenshotDataUri });
        break;
      case 'observer':
        setObserver(ev.data);
        setObsBullets(observerBullets(ev.data));
        setObsState('done');
        setPerAgent((p) => ({ ...p, observer: ev.latencyMs }));
        break;
      case 'triage':
        setTriage(ev.data);
        setTriBullets(triageBullets(ev.data));
        setTriState('done');
        setPerAgent((p) => ({ ...p, triage: ev.latencyMs }));
        setLiveSteps((prev) =>
          prev.map((s) => (s.index === index ? { ...s, severity: ev.data.severity } : s)),
        );
        break;
      case 'callback':
        if (ev.fired) {
          setCallback({ fired: true, question: ev.question, answer: ev.answer, showAnswer: true });
          if (ev.latencyMs) setPerAgent((p) => ({ ...p, callback: ev.latencyMs }));
        } else {
          setCallback(null);
        }
        break;
      case 'commander':
        setCommander(ev.data);
        setPlanIn(true);
        pulsePlan();
        setPerAgent((p) => ({ ...p, commander: ev.latencyMs }));
        break;
      case 'done':
        setTotals({ totalMs: ev.latencies.totalMs, imageTokens: ev.imageTokens });
        break;
    }
  }

  async function runLive() {
    setPhase('running');
    setMode('live');
    resetDisplay();

    try {
      const res = await fetch('/api/incident/live');
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
          const msg = JSON.parse(line);
          if (msg.t === 'tick_start') {
            setLiveEvidence({ label: msg.label, detail: msg.detail });
            setObsState('active');
            setTriState('active');
            setLiveSteps((prev) => {
              if (prev.some((s) => s.index === msg.index)) return prev;
              return [...prev, { index: msg.index, label: msg.label, detail: msg.detail, status: 'active' }];
            });
          } else if (msg.t === 'agent') {
            handleLiveAgent(msg.index, msg.event as IncidentEvent);
          } else if (msg.t === 'tick_end') {
            setLiveSteps((prev) =>
              prev.map((s) => (s.index === msg.index ? { ...s, status: 'done' } : s)),
            );
          } else if (msg.t === 'tick_error') {
            // Non-fatal: this tick's chain failed. Keep the last good plan on
            // screen, flag the step, and let the run continue.
            setObsState('done');
            setTriState('done');
            setLiveSteps((prev) =>
              prev.map((s) => (s.index === msg.index ? { ...s, status: 'done', warn: true } : s)),
            );
          } else if (msg.t === 'done') {
            setPhase('done');
            setLiveEvidence(null);
          } else if (msg.t === 'error') {
            setError(msg.error);
          }
        }
      }
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('done');
    }
  }

  const sev = triage?.severity;
  const status = triage ? triageStatus(triage) : null;
  const running = phase === 'running';

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
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden lg:block text-xs text-muted-foreground mr-2">
            Incident&nbsp;starts → Evidence&nbsp;evolves → Agents&nbsp;react → Plan&nbsp;changes
          </span>
          <Button variant="outline" onClick={run} disabled={running}>
            {running && mode === 'oneshot' ? 'Running…' : 'Load Demo Incident'}
          </Button>
          <Button onClick={runLive} disabled={running}>
            {running && mode === 'live' ? 'Live…' : '▶ Simulate Live Incident'}
          </Button>
        </div>
      </header>

      {/* Live timeline rail */}
      {mode === 'live' && liveSteps.length > 0 && (
        <div className="border-b px-6 py-2 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">
            Evidence timeline
          </span>
          {liveSteps.map((s, i) => (
            <div key={s.index} className="flex items-center gap-2 shrink-0">
              {i > 0 && <span className="text-border">→</span>}
              <div
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-all duration-300 ${
                  s.status === 'active' ? 'border-primary ring-1 ring-primary/40' : 'opacity-90'
                }`}
              >
                <span className="font-medium">{s.label}</span>
                {s.severity && <Badge className={`${SEV_CLASS[s.severity]} text-[10px]`}>{s.severity}</Badge>}
                {s.warn && <span title="plan update skipped this tick" className="text-amber-400">⚠</span>}
              </div>
            </div>
          ))}
          {liveEvidence && (
            <span className="text-xs text-muted-foreground italic ml-2 shrink-0">
              ← {liveEvidence.detail}
            </span>
          )}
        </div>
      )}

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
                  key={inputs.screenshot.slice(-24)}
                  src={inputs.screenshot}
                  alt="incident dashboard screenshot"
                  className="w-full rounded-md border animate-in fade-in duration-500"
                />
              ) : (
                <div className="aspect-[2/1] w-full rounded-md border border-dashed grid place-items-center text-xs text-muted-foreground">
                  {mode === 'live' ? 'no dashboard yet' : 'dashboard screenshot'}
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
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agents</h2>

          {mode === 'idle' ? (
            <Card className="grid place-items-center py-16 text-center">
              <CardContent className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Load Demo Incident</span> runs the
                  one-shot analysis.
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">▶ Simulate Live Incident</span> plays
                  an evolving incident — watch severity &amp; plan mutate.
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
              } ${planHighlight ? 'ring-2 ring-primary/60' : ''}`}
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
        <span className="text-muted-foreground uppercase tracking-wider">
          Latency {mode === 'live' ? '(latest tick)' : '(live)'}
        </span>
        <Lat label="🛰️ Observer" ms={perAgent.observer} />
        <Lat label="🚨 Triage" ms={perAgent.triage} />
        <Lat label="↔️ Callback" ms={perAgent.callback} />
        <Lat label="🎯 Commander" ms={perAgent.commander} />
        <span className="text-border">|</span>
        <span className="font-semibold">
          {mode === 'live' ? 'Tick chain:' : 'Total chain:'}{' '}
          {totals ? `${(totals.totalMs / 1000).toFixed(2)}s` : <span className="text-muted-foreground">—</span>}
        </span>
        {totals?.imageTokens != null && totals.imageTokens > 0 && (
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
