# PulseOps — Build Plan for Claude Code

**Real-Time AI Incident Command Center**
Cerebras × Google DeepMind Gemma 4 24-Hour Hackathon (Jun 28–29, 2026)

---

## 0. Read this first

This file is the single source of truth for the build. The plan is locked
through several rounds of design review — **do not re-architect it.** Implement
it cleanly and fast, de-risking the fragile parts first. When a decision is
ambiguous, prefer the choice that makes the **60-second demo** more reliable,
not the one that makes the product more complete. We are shipping a polished
demo, not a full product.

**One-line thesis the whole project must prove:**
> Incident response only works if the AI is fast enough to operate *while the
> incident is unfolding*. Cerebras makes Gemma 4 31B fast enough to **run a live
> incident command center** — not just generate a report after the fact.

**The litmus test every decision is measured against:**
> If Cerebras suddenly became 10x slower, would this demo *stop working*, or
> just get *annoying*? The winning version stops working — because the live
> ticks can't keep pace and the command center stops feeling alive. That is the
> Cerebras dependency made undeniable.

---

## 0.1 The two-layer structure (READ BEFORE BUILDING ANYTHING)

This project has a **protected floor** and a **winning upside**. They are built
in order. The upside never replaces the floor.

### LAYER 1 — PROTECTED FLOOR: one-shot incident analysis (build FIRST)
A single-run version: load one incident (screenshot + logs + complaint) → run
the agent chain once → a structured incident-command plan snaps into place.
This is recordable on its own and can win Track 3 by itself. **This must be
fully working and demo-recordable before any Live Mode code is written.**

### LAYER 2 — WINNING UPSIDE: Live Mode / simulated evolving incident (build SECOND)
On top of the working one-shot core, add a mode where evidence arrives over
time (every 2–3s), the agents re-run, and severity / plan / customer update /
timeline visibly mutate on screen. This is what makes Cerebras load-bearing and
the demo memorable. It elevates the entry for Track 1.

### CUT LINE
If Live Mode is unstable at any point, **fall back to the one-shot floor and
ship that.** A polished one-shot demo is a strong submission. A half-working
Live Mode at deadline is nothing recordable. **Never sacrifice the floor for the
upside.** Live Mode joins the protect list ONLY after the one-shot core runs
end-to-end.

---

## 1. Secrets / API key handling — DO THIS RIGHT

- The Cerebras API key is **never** hardcoded into any file, commit, or UI.
- Read it from the environment: `CEREBRAS_API_KEY`.
- Create a `.env.local` (Next.js convention) that is **git-ignored**. Confirm
  `.env*` is in `.gitignore` before the first commit.
- The model ID is `gemma-4-31b`.
- During demo recording, ensure no key, token, env file, notification, or email
  is ever visible on screen (hackathon rule).

**Reference (Python SDK shape, for understanding the API only — actual build is TS/Next.js):**
```python
from cerebras.cloud.sdk import Cerebras
client = Cerebras(api_key=os.environ.get("CEREBRAS_API_KEY"))
stream = client.chat.completions.create(
    messages=[{"role": "system", "content": "..."}],
    model="gemma-4-31b",
    stream=True,
    max_completion_tokens=32768,
    temperature=0.2,
    top_p=1,
)
```

Cerebras exposes an **OpenAI-compatible Chat Completions API**. In the Next.js
app, call it from server-side routes (never the browser) using the
OpenAI-compatible endpoint. **Before writing orchestration code, confirm the
exact TypeScript usage, the image-input format, and structured-output
parameters against the official Cerebras docs** (linked from the hackathon PDF:
model details for `gemma-4-31b`, image inputs guide, API reference, reasoning
guide). Do not rely on memory for request shapes — pin them to current docs.

---

## 2. Stack (locked)

- Next.js (App Router) + TypeScript
- Tailwind + shadcn/ui
- Zod for output validation (see §4.3)
- Vercel for deploy (local dev is fine for the demo; deploy only if time permits)
- Cerebras OpenAI-compatible API, model `gemma-4-31b`
- **No Supabase, no auth, no database** (cut item — see §8). Live Mode state is
  in-memory.
- **No LangGraph.** Orchestrate with plain TypeScript functions. (Cut item.)
- Optional second provider (a GPU-hosted comparable model) **only** for the
  latency baseline — see §6. Built **last**.

---

## 3. Product concept

A web app that runs a live incident command center. A user (or the built-in
simulator) feeds messy multimodal incident evidence; a fast multi-agent
workflow turns chaos into a structured, continuously-updating incident-command
plan in seconds.

**Inputs (per the visual-token policy in §5):**
- A dashboard / alert **screenshot** (image — situational awareness only)
- **Logs** (pasted as text)
- A **customer complaint / incident note** (pasted as text)

**Output:** severity, suspected root cause, immediate actions, owner tasks,
customer update, executive summary — produced fast enough to feel live, and in
Live Mode, *updated* fast enough to feel alive.

---

## 4. Agent architecture (locked — plain TS functions)

Three live agents (**Observer, Triage, Commander**) plus a **stubbed, not-wired
Critic**. Each agent = one async TS function that calls Cerebras and returns
**strict, parseable JSON**. This same chain is the engine for BOTH the one-shot
floor and each Live Mode tick.

### 4.1 UI-facing agent identities
Present the agents with names — easier to read on video than "Agent 1/2/3":
- 🛰️ **Observer** (the Perceiver)
- 🚨 **Triage**
- 🎯 **Commander**

**Agent active state — stream findings, NEVER show "Thinking…".** A spinner or
"Thinking…" is a dead state. Instead, each agent reveals its actual findings as
**checked bullets appearing one at a time**:
```
🛰️ Observer
  ✓ Database latency detected
  ✓ Elevated API failures
  ✓ Connection pool saturation
```
Motion is perceived as intelligence. Implementation:
- Drive the bullets from the model's **real streamed output** where possible
  (Observer genuinely emits `observations` / `possible_signals`; stream those in
  as they arrive). These are real findings, not fabricated copy.
- Apply a small **minimum stagger (~150–300ms between bullets)** so that even
  when Cerebras returns the whole response near-instantly, the eye still
  perceives the motion. Pacing is for perception only — the content is real.
- This is purely a presentation layer over the structured JSON each agent
  already returns; it does not change the agent contracts in §4.7.

### 4.2 Flow
```
            ┌─ screenshot ─┐
            ├─ logs ───────┤  (these three perception subcalls may run
            └─ complaint ──┘   IN PARALLEL — see §4.5)
                   │
                Observer  (merges the three into one perception object)
                   │
                 Triage
                   │
               Commander
                   │
   (code-evaluated callback condition?) ──yes──> Observer (one targeted Q) ──> Commander finalizes
                   │
                   no ──> Commander finalizes
                   │
                Critic (STUBBED — NOT WIRED — see §4.6)
```

### 4.3 Structured output: strict mode + Zod + one repair retry
The hackathon docs confirm Cerebras supports **Structured Outputs with strict
mode (`strict: true`)** to constrain output to a JSON schema for `gemma-4-31b`.
Use it. **But still validate defensively:**
1. Request strict structured output (per-agent JSON schema). Confirm the exact
   parameter shape (`response_format` / `json_schema`) against the Cerebras API
   reference doc before wiring — pin to current docs, not memory.
2. Parse the response, then **validate with Zod** against the agent's schema.
3. On validation failure: **one repair retry** (re-prompt asking the model to
   fix the JSON to match the schema). No infinite loops — one retry, then fail
   gracefully with a safe default for that field.
Test all three live schemas under strict mode in the **first hour**. If strict
mode is rejected/flaky for any schema, lean harder on the Zod-repair path for
that agent — discover this at hour 1, not hour 18.

### 4.4 Deterministic callback — trigger AND question generated in CODE
The signature multi-agent moment must NOT depend on a model deciding to ask or
wording the question. Both are code:

**Trigger (code reads Triage output):**
```ts
const needsCallback =
  triage.confidence < 0.75 || triage.missing_evidence.length > 0;
```

**Question (code fills a template, injecting a real Triage value so it reads as
dynamic, not canned):**
```ts
const suspectedSystem = triage.affected_systems[0] ?? "the API layer";
const question =
  `Re-check the screenshot. Is ${suspectedSystem} showing signs of saturation, ` +
  `degradation, or dependency failure?`;
```
Use `affected_systems[0]` (a system *name*), NOT `primary_hypothesis` (which is a
full sentence and reads awkwardly when slotted into a question). This produces
natural demo copy like: "Re-check the screenshot. Is the database tier showing
signs of saturation, degradation, or dependency failure?"

The Observer answers **only** that question with a tiny focused prompt — do
**not** re-send full context. Commander then finalizes. The Commander does NOT
emit a callback-request JSON (removed — it was a flaky model step on the most
important moment).

### 4.5 Parallel perception (honest throughput use only)
The three perception subcalls — screenshot analysis, log analysis, complaint
analysis — are independent and may run **concurrently** (`Promise.all`), then
merge into the Observer's perception object. This is a real, demonstrable use of
Cerebras throughput. **Do NOT manufacture parallelism elsewhere:** Triage
depends on Observer, Commander depends on Triage — those stay sequential because
the data flow requires it. Use parallelism only where it's real; let Live Mode
(§7) carry the main speed story.

### 4.6 Critic — STUBBED, NOT WIRED
Keep the Critic schema and a stubbed function in the repo so re-adding it later
is a 10-minute job, but **do not wire it into the live chain.** The
Observer↔Commander callback already proves multi-agent coordination. Only wire
Critic in if everything else (including Live Mode) is done and stable.

### 4.7 Agent I/O contracts

**Observer (Perceiver)** — consumes screenshot (image), logs (text), complaint (text). Emits:
```json
{
  "observations": ["string"],
  "visible_systems": ["string"],
  "possible_signals": ["string"],
  "uncertainties": ["string"],
  "image_summary": "string"
}
```

**Triage** — consumes Observer output + raw pasted text. Emits:
```json
{
  "severity": "SEV1 | SEV2 | SEV3 | SEV4",
  "confidence": 0.0,
  "missing_evidence": ["string"],
  "affected_systems": ["string"],
  "likely_category": "availability | latency | data | security | customer_support | unknown",
  "primary_hypothesis": "string",
  "why_now": "string"
}
```
> `confidence` and `missing_evidence` drive the code-evaluated callback (§4.4).
> `confidence` is kept internally but is NEVER shown as a decimal in the UI (§7.3).

**Commander** — consumes Observer output + Triage output (+ callback answer if one occurred). Final output:
```json
{
  "incident_title": "string",
  "situation_summary": "string",
  "immediate_actions": ["string"],
  "owners": [{ "role": "string", "task": "string", "priority": "P0 | P1 | P2" }],
  "customer_update": "string",
  "executive_summary": "string",
  "next_15_minutes": ["string"]
}
```

**Critic (STUBBED — schema only, not wired)** — would consume Commander plan + Triage. Emits:
```json
{
  "approved": true,
  "risks_or_gaps": ["string"],
  "recommended_edits": ["string"],
  "final_grade": "safe | needs_review"
}
```

---

## 5. Visual token budget policy (locked)

- Do **not** depend on OCR from screenshots.
- Logs → pasted text. Customer complaints → pasted text.
- Screenshots are for **situational awareness** only: charts, red/yellow
  indicators, topology, dashboards, alert density, degraded areas.
- Use a **low visual token budget (~140, up to 280)** for speed.
- Never design the demo so the model must read tiny stack traces from an image.
- Demo wording: "Logs come in as text. The screenshot gives situational awareness."

---

## 6. Latency / baseline strategy (locked — baseline built LAST)

- **Never hardcode benchmark numbers.** Show only **real measured** values.
- Measure and display **per-agent AND full-chain** latency:
  - Observer latency
  - Triage latency
  - Commander latency
  - callback latency (when it fires)
  - **total chain latency**
  Per-agent breakdown makes the speed *legible* — the judge sees real calls each
  finishing fast, not one black-box number. Keep the breakdown in a clean strip;
  don't let it clutter the one beautiful moment (§7).
- Cerebras responses include usage stats and a `time_info` object — use real
  values from there.
- **Baseline is optional and built LAST.** Do not let second-provider setup
  delay the winning artifact.
  - Primary: Cerebras `gemma-4-31b`, live.
  - Baseline: a **comparable** GPU-hosted model, **same prompt**, live if stable
    else pre-recorded honestly.
  - Use a fair baseline. **A credible ~3x improvement beats a suspicious 6x.**
    Never use a deliberately weak baseline — judges will notice.

---

## 7. The one beautiful moment + Live Mode UI

### 7.1 The premium moment (applies to BOTH layers)
The whole app does **not** need to be beautiful — clean shadcn defaults
everywhere **except one moment**, which must feel premium:
> messy screenshot + logs + complaint → agent cards (Observer/Triage/Commander)
> animate in sequence (including the visible callback) → the incident command
> plan **snaps into place** on the right.

Suggested layout:
- **Left:** incoming evidence (screenshot thumbnail, logs, complaint)
- **Center:** agent cards that reveal findings as **streamed checked bullets,
  one at a time** (§4.1) — never a "Thinking…" spinner; the callback shows as a
  visible exchange:
  - 🎯 Commander: "Observer, is the database tier showing signs of saturation, degradation, or dependency failure?"
  - 🛰️ Observer: "Confirmed: dashboard highlights DB latency and connection saturation."
- **Right:** the command plan appearing rapidly (SEV, root cause, immediate
  actions, customer update, exec summary)
- **Bottom:** per-agent + total latency strip (§6).

**Frame the flow as an evolving incident, not a request/response.** The mental
model and any flow diagram in the UI should read as a live incident, NOT
"Upload → AI → Answer":
```
Incident starts
   ↓
Evidence evolves
   ↓
Agents react
   ↓
Plan changes
   ↓
Customer update changes
   ↓
Executive summary changes
```
This reinforces "run the incident room" over "generate a report" — even in the
one-shot floor, frame it as the first moment of a live incident, not a one-time
query.

### 7.2 Live Mode (LAYER 2 — the upside)
A **▶ Simulate Live Incident** button plays a **pre-scripted evidence timeline**
(staged, deterministic, identical every take). Every 2–3s a new piece of
evidence arrives (new logs / new screenshot / new alert / customer message); the
chain re-runs; severity, plan, customer update, and timeline **visibly mutate**
on screen. Example scripted arc:
```
Complaint arrives ............ SEV2
+2s new dashboard screenshot . SEV1
+3s rollback initiated ....... plan updates
+3s recovery detected ........ customer update + exec summary regenerate
```
Judges remember **motion** — things changing, reacting, updating. This is the
memorable beat and the honest proof of Cerebras dependency: at 10x slower the
ticks can't keep up and the room stops feeling alive.

Concurrency note: ensure overlapping ticks don't stomp state if one model call
runs slower than the tick interval (debounce / cancel-in-flight / queue). Keep
state updates incremental (severity/plan/timeline update in place, no full
re-render flash).

### 7.3 UI status text — human, not decimals
Never show `confidence = 0.73` in the UI. The model still emits the number and
code still triggers the callback on it (§4.4), but the UI shows human-readable
status:
- low confidence / missing evidence → **"Evidence conflict detected"** or
  **"Needs more evidence"**
- otherwise → **"High confidence"** / a calm green state.

### 7.4 Demo entry points
- **Load Demo Incident** — loads the one perfect canned incident for the
  ONE-SHOT floor (inputs only; model outputs still generated live). Use this to
  record the floor demo identically every take.
- **▶ Simulate Live Incident** — the Live Mode scripted timeline (the upside).
- Custom upload/paste stays available to prove generality, but **record against
  the canned/scripted inputs** so runs are identical.

---

## 8. Scope: protect vs cut

**Protected floor (build first, never sacrifice):**
1. Multimodal input (image + pasted text)
2. Observer → Triage → Commander one-shot workflow
3. Deterministic, code-driven Observer callback
4. Live Cerebras latency metrics (real, per-agent + total)
5. One beautiful chaos → command transition
6. One perfect sample incident
7. "Load Demo Incident" one-shot path, fully recordable

**Winning upside (build second, ONLY after the floor runs):**
8. Live Mode / "Simulate Live Incident" with scripted evolving evidence
9. Parallel perception subcalls (§4.5)

**Cut first (in this order) if behind:**
1. Live Mode → **fall back to the one-shot floor** (§0.1 cut line)
2. Critic (already stubbed/unwired)
3. Supabase persistence
4. Timeline agent (beyond the simple Live Mode timeline strip)
5. Export report
6. Baseline / second provider
7. Multiple demo scenarios
8. Auth / settings
9. LangGraph visualization

If badly behind: ship the hard-coded perfect one-shot incident so the demo
always has something flawless.

---

## 9. The one perfect sample incident (design carefully)

Engineer the sample so the callback fires **honestly**:
- The **text** (logs + complaint) points at one thing (e.g. "API errors /
  elevated 5xx").
- The **screenshot** suggests an overlapping-but-not-identical cause (e.g.
  database latency / connection saturation).
- This makes Triage **genuinely uncertain** → `confidence < 0.75` and/or
  `missing_evidence` non-empty → callback is the honestly-correct move.
- **Verify in the first hour** that Triage actually returns sub-0.75 confidence
  on this sample. If overconfident, tune the sample or add calibration guidance
  to the Triage prompt until uncertainty is the honest output. Do not fake it.

For Live Mode, extend this into a **scripted multi-step timeline** (§7.2) where
each new piece of evidence honestly changes severity/plan.

---

## 10. Build order (de-risk fragile things first, while Cerebras engineers are online Sun 10:30–12:30 PT)

**Phase A — Protected floor (one-shot):**
1. **One bare Cerebras call** from a server route: `gemma-4-31b`, strict JSON for
   a single schema. Confirm parseable JSON reliably; add Zod + one repair retry.
2. **Confirm image input** works (exact format per docs — base64 data URI vs
   hosted URL). The whole multimodal story depends on this; test at hour 1.
3. **Wire Observer → Triage → Commander** as plain TS functions end-to-end with
   **ugly UI**, including the code-driven callback. Confirm strict JSON for all
   three schemas early.
4. **Measure latency** (per-agent + total). Confirm the chain feels live and that
   image calls + accumulated context fit the event budget (5K MSL / 32K MCL).
5. **Build the one beautiful transition** (§7.1) + "Load Demo Incident".
   → **This is the recordable floor. Make sure it can be demoed before moving on.**

**Phase B — Winning upside (Live Mode):**
6. Add **parallel perception** (§4.5) where the data flow allows.
7. Add **Live Mode** (§7.2): scripted evidence timeline, ticking loop,
   incremental state updates, overlap handling, human-readable status (§7.3).
   → If this destabilizes, **cut back to Phase A and ship it.**

**Phase C — Last:**
8. **Real baseline call** (§6), only if core + Live Mode are stable.

---

## 11. Three submissions from one build (different framing, same app)

- **Track 1 — Multiverse Agents:** lead with the agents + visible callback +
  multimodal input + **Live Mode motion** + speed. Strongest agent-collaboration
  and "speed changes what's possible" story.
- **Track 3 — Enterprise Impact:** lead with incident-response / cybersecurity /
  knowledge-management value, production framing, and how Cerebras speed + Gemma
  4 31B multimodal create a better enterprise experience. The one-shot floor
  alone can carry this.
- **Track 2 — People's Choice (minimal energy):** post the best ~30–60s cut
  (Live Mode motion is the shareable hook) to X, tag **@Cerebras** and
  **@googlegemma**, rally friends/family. Do **not** build social features.

Each track = a separate Discord post in its channel. Video ≤ 60s, must show
Cerebras speed, no sensitive info on screen. Deadline: **Mon Jun 29, 10:00 AM PT.**

---

## 12. Non-negotiables checklist

- [ ] Key only in git-ignored `.env.local`, read via `CEREBRAS_API_KEY`
- [ ] `gemma-4-31b` via OpenAI-compatible API, confirmed against live docs
- [ ] Image input format confirmed at hour 1
- [ ] Strict structured output + Zod validation + one repair retry, all 3 schemas
- [ ] Callback trigger AND question generated in CODE (Commander emits no callback JSON)
- [ ] Callback fires on the sample (`confidence < 0.75 || missing_evidence.length > 0`)
- [ ] Per-agent + full-chain latency, real and measured, never hardcoded
- [ ] One beautiful chaos → command transition
- [ ] One perfect sample incident that makes the callback honest
- [ ] ONE-SHOT FLOOR is recordable before Live Mode is started
- [ ] Live Mode layered on top; falls back to one-shot if unstable
- [ ] UI shows "Evidence conflict detected", never a confidence decimal
- [ ] Agents labeled Observer / Triage / Commander
- [ ] Agent cards stream findings as staggered checked bullets — never a "Thinking…" spinner
- [ ] Flow framed as an evolving incident, not "Upload → AI → Answer"
- [ ] Nothing sensitive visible in the recording
