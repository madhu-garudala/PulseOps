# PulseOps

**A real-time AI incident command center: a three-agent chain on Cerebras-hosted Gemma 4 31B turns a dashboard screenshot, raw logs, and a customer complaint into a structured incident-response plan in seconds, then keeps that plan updated as new evidence comes in.**

PulseOps was built for the Cerebras x Google DeepMind Gemma 4 24-hour hackathon. The idea it tests: incident response is only useful if the AI is fast enough to work *while the incident is still unfolding*, not just write a report afterwards. Every latency shown in the UI is measured from a live API call.

---

## What it does

- **One-shot incident analysis ("Load Demo Incident").** Loads a sample incident (dashboard screenshot + log feed + support escalation) and runs the agent chain once. Results stream into the UI one agent at a time as NDJSON.
- **Live Mode ("Simulate Live Incident").** Plays a fixed four-step evidence timeline about 3 seconds apart: first report, then escalation plus dashboard, then mitigation underway, then recovery detected. The full chain re-runs on the accumulated evidence at each step, so severity, the plan, the customer update and the executive summary change on screen as the incident develops.
- **Structured incident-command output.** Severity (SEV1–SEV4), affected systems, primary hypothesis, immediate actions, owner tasks with priorities (P0–P2), customer update, executive summary, and a "next 15 minutes" checklist.
- **Deterministic agent callback.** When Triage reports low confidence or missing evidence, code (not the model) decides to ask the Observer a follow-up question, writes that question, and sends it with the screenshot before the Commander finalizes.
- **Per-agent latency.** Wall-clock timings for Observer, Triage, the callback, Commander, and the whole chain, plus image-token usage when the API reports it.
- **Speed baseline ("Speed Baseline").** Sends the same multimodal prompt to Cerebras `gemma-4-31b` and to OpenAI `gpt-4o`, one after the other, streaming both. It measures time to first token, total time and tokens/sec, then reports the speedup ratio. If a provider fails, the UI shows its error and no number is made up.

> Current scope: every endpoint runs against the bundled sample incident in `data/sample-incident/`. There is no upload or paste-your-own-evidence flow yet.

---

## How it works

### Agent chain

```
 screenshot + logs + complaint
              │
          Observer      perception: observations, visible systems, signals,
              │         uncertainties, one-line image summary
            Triage      severity, confidence, missing evidence, affected
              │         systems, category, primary hypothesis, why now
              │
   needsCallback(triage)?   (code: confidence < 0.75 OR missing_evidence non-empty)
        │ yes                          │ no
   Observer callback                   │
   (one templated question about       │
    affected_systems[0], screenshot    │
    only, no full context)             │
        └──────────────┬───────────────┘
                   Commander    final incident-command plan
```

The orchestration is written as plain async TypeScript functions, with no agent framework. Observer, Triage and Commander run one after another because each needs the previous agent's output. A `Critic` schema is defined in `src/lib/schemas.ts` but is deliberately not used in the chain.

### Structured output contract

Every agent call goes through `callCerebrasStructured` in `src/lib/cerebras.ts`, which works like this:

1. Asks for strict JSON-schema output (`response_format: { type: "json_schema", json_schema: { strict: true, ... } }`).
2. Takes the JSON object out of the response and checks it with a Zod schema.
3. If validation fails, retries **once** with strict decoding turned off, a higher temperature and an instruction to return compact JSON only. If it is still invalid, it throws.
4. Returns the measured latency, `usage` and Cerebras `time_info`, and a flag showing whether the retry was needed.

Screenshots are sent as base64 `data:image/png` URIs. They give the model a general picture of the system state (red/amber indicators, saturation). The prompts tell the model not to read small text off the image.

### Streaming

- `/api/incident/stream` and `/api/incident/live` return `application/x-ndjson`, with one JSON event per line for each agent step.
- Live Mode runs its steps **one at a time**. Each step's chain finishes before the next starts, and step starts are spaced `LIVE_TICK_MS` (3000 ms) apart. If a chain takes longer than that, the next step waits rather than overlapping. If one step fails, it sends a `tick_error` and the run continues.

### Models and APIs

| Purpose | Provider / SDK | Model |
| --- | --- | --- |
| All agents (Observer, Triage, callback, Commander) | Cerebras Cloud (`@cerebras/cerebras_cloud_sdk`) | `gemma-4-31b` |
| Latency baseline (primary side) | Cerebras Cloud | `gemma-4-31b` |
| Latency baseline (comparison side) | OpenAI (`openai`) | `gpt-4o` |

All model calls happen in server-side route handlers. API keys are read from `process.env` at call time and never reach the browser.

---

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (`base-nova` style, Base UI primitives, `lucide-react` icons)
- **Zod 4** for validating model output
- **Cerebras Cloud SDK** and **OpenAI SDK** (OpenAI is used only for the baseline)
- No database, no auth. All state lives in memory or in the stream.

---

## Prerequisites

- Node.js 20+ and npm
- A Cerebras Cloud API key with access to `gemma-4-31b`
- (Optional) An OpenAI API key, needed only for the Speed Baseline comparison

---

## Setup

```bash
git clone <your-fork-url> pulseops
cd pulseops
npm install
```

Create a `.env.local` in the project root. `.env*` files are already git-ignored.

```bash
# Required: used by every agent call and the Cerebras side of the baseline
CEREBRAS_API_KEY=your-cerebras-api-key

# Optional: only used by /api/baseline (the "Speed Baseline" button)
OPENAI_API_KEY=your-openai-api-key
```

If `OPENAI_API_KEY` is not set, the baseline still runs the Cerebras side and shows the OpenAI side as unavailable.

---

## Running

Scripts defined in `package.json`:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

Open the app and use one of the three header buttons: **Load Demo Incident**, **Simulate Live Incident**, or **Speed Baseline**.

### API routes

All routes are `GET` and run dynamically, with no caching.

| Route | Response | Description |
| --- | --- | --- |
| `/api/incident/stream` | NDJSON | One-shot chain on the sample incident, streamed per agent |
| `/api/incident/live` | NDJSON | Four-step scripted Live Mode timeline, chain re-run each step |
| `/api/run-chain` | JSON | One-shot chain, full result returned at the end (no streaming) |
| `/api/baseline` | JSON | Cerebras vs OpenAI single-call latency comparison |

---

## Project structure

```
pulseops/
├── data/
│   └── sample-incident/          # Synthetic demo incident (see below)
├── public/                       # Static assets (default Next.js SVGs)
├── src/
│   ├── app/
│   │   ├── page.tsx              # Command-center UI (evidence, agent cards, plan, latency strip)
│   │   ├── layout.tsx, globals.css
│   │   └── api/
│   │       ├── incident/stream/route.ts   # One-shot NDJSON stream
│   │       ├── incident/live/route.ts     # Live Mode NDJSON stream
│   │       ├── run-chain/route.ts         # One-shot, non-streaming JSON
│   │       └── baseline/route.ts          # Cerebras vs OpenAI latency
│   ├── components/ui/            # shadcn/ui primitives (badge, button, card, separator)
│   └── lib/
│       ├── cerebras.ts           # Cerebras client + strict-output / Zod / repair-retry helper
│       ├── orchestrate.ts        # runIncident(): Observer -> Triage -> callback -> Commander
│       ├── callback.ts           # Code-based callback trigger + question template
│       ├── schemas.ts            # Zod schemas + strict JSON Schemas for each agent (+ unused Critic)
│       ├── agents/
│       │   ├── observer.ts       # Perception agent + focused callback answer
│       │   ├── triage.ts         # Severity / hypothesis / confidence
│       │   └── commander.ts      # Final incident-command plan
│       ├── sample.ts             # Loads data/sample-incident as an IncidentInput
│       ├── live-script.ts        # Scripted Live Mode timeline (4 cumulative steps)
│       ├── baseline.ts           # Streamed single-call benchmark on both providers
│       └── utils.ts              # cn() class-name helper
├── plan.md                       # Original hackathon build plan / design notes
├── next.config.ts                # Bundles data/sample-incident/** into the API route builds
└── components.json               # shadcn/ui config
```

---

## The `data/` folder

`data/sample-incident/` holds one **synthetic** demo incident: a checkout/payments outage caused by database connection-pool saturation. The API routes read these files at runtime.

| File | Contents |
| --- | --- |
| `complaint.txt` | Fictional support escalation (enterprise customers report failing checkout) |
| `logs.txt` | About 12 minutes of made-up `api-gateway` / `payments-svc` log lines (5xx errors, timeouts, circuit breaker opening) |
| `dashboard.html` | Source HTML for a hand-built "data tier" dashboard showing DB latency and pool saturation |
| `screenshot.png` | 1000x500 render of `dashboard.html`, sent to the model as the incident screenshot |
| `dashboard_recovering.html` | Source HTML for the same dashboard during recovery |
| `screenshot_recovering.png` | Render of the recovering dashboard, used in Live Mode's final step |

The dashboard deliberately emphasizes database signals, while the logs and complaint describe 5xx errors on the payment path. This gap between the text evidence and the screenshot gives the Triage and callback steps something real to resolve. The extra log lines for Live Mode's mitigation and recovery steps are defined inline in `src/lib/live-script.ts`.

---

## Notes and limitations

- Results come from a live LLM, so wording and severity can vary between runs. Only the input evidence is fixed.
- Displayed latencies are wall-clock times measured on the server around each SDK call, so they include network time.
- The baseline compares one identical prompt on each provider, not the full three-agent chain.
- `next.config.ts` uses `outputFileTracingIncludes` so the sample-incident files are included in serverless builds.
