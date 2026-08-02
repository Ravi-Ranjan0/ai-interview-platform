# Audit Log

## Cycle 6 — Stuck-forever states + a missed authz gap — 2026-08-03
### Scope
Full 4-role sweep (bugs/features/perf) per the standing audit process, with
the in-flight document pipeline treated as critical path per plan. Ran tsc
(0 errors, matches last known-green baseline) and `next build` (green,
confirmed this cycle). `next lint` has no committed ESLint config in this
repo — `next lint` drops into the interactive "how would you like to
configure ESLint" wizard rather than running; not exercised, flagged below
as a gap rather than silently skipped.

### Fixed this cycle
- **G3 — `meetings.update` accepted a client-supplied `agentId` with no
  ownership check.** Same class as G1/G2 (cycle 3), missed there because
  cycle 3's sweep covered `create` mutations but not `update`. Reused
  `assertAgentOwned` (already imported in the file) before the update.
  [src/modules/meetings/server/procedures.ts:169-173] Before: a user could
  point their own meeting's `agentId` at another user's private agent
  (IDOR-adjacent — bounded by needing to know/guess that agent's id, since
  ids are nanoids, not sequential). After: `NOT_FOUND` if the agent isn't
  theirs, matching every other agentId-accepting writer.
- **Stuck-forever state, instance 1 — `processDocumentEmbeddings`.** Only
  the "no text extracted" branch ever set `status: "failed"`. Any other
  failure (fetch/parse error, Gemini error, vector dimension mismatch,
  Qdrant unreachable) threw past all `step.run` calls; after Inngest's
  retries exhausted, the document was left at `status: "processing"`
  forever with no `error` set and no way for the UI to distinguish "still
  working" from "silently dead." Wrapped steps 5-7 in try/catch; any error
  now runs a `mark-failed` step with the caught message and returns
  `{success:false}` instead of rethrowing (matching the existing
  empty-text branch's pattern — a handled failure, not an Inngest retry
  loop). [src/inngest/functions.ts, `processDocumentEmbeddings`]
- **Stuck-forever state, instance 2 — `agentChatHandler`.** The final LLM
  call (`instructionOnlyAgent.run(prompt)`, intentionally left outside
  `step.run` as agent-kit doesn't support nested steps) had no catch. A
  transient Gemini error meant no agent-reply row was ever written; the
  chat UI polls `getMessages` while the last message is the user's
  (`agent-chat.tsx:130-131,172`) with no timeout, so the user saw the
  typing indicator spin forever with no error, no retry, no recovery short
  of leaving the page. Wrapped the call; on failure it now saves a fallback
  reply ("Sorry, I couldn't generate a reply just now...") with an
  `llmError` field in metadata (same shape as the existing `retrievalError`
  field from N1/cycle 4) so polling always terminates. UI not changed to
  render `llmError` specially — the fallback message content itself is
  sufficient signal; parseMeta already ignores unknown metadata keys
  harmlessly. [src/inngest/functions.ts, `agentChatHandler`]
- **A8 — Qdrant collection auto-recreate on dimension mismatch, closed.**
  `ensureAgentCollection` used to silently `deleteCollection` + recreate
  whenever the detected vector size didn't match (or couldn't be
  determined) — since every agent's vectors share one `agents` collection,
  this is a platform-wide, irreversible wipe triggered by e.g. an embedding
  model config change or a fragile `(info as any).vectors?.size` detection
  path missing a field Qdrant's API happens to nest differently. Changed to:
  real mismatch → throw a descriptive error requiring manual migration;
  undetectable size → warn and assume it's fine (don't nuke on ambiguous
  data); matches size → no-op. A genuine dimension migration is now a
  deliberate ops action, never an automatic side effect of a request.
  [src/lib/qdrant.ts, `ensureAgentCollection`]
- **A12/A13 — missing DB indexes, closed.** Zero `index()` calls existed
  anywhere in `schema.ts`; every FK and every `status`/`userId`/`agentId`
  lookup relied on a full scan of the PK. Added indexes on `session.userId`,
  `account.userId`, `agents.userId`, `meetings.{userId,agentId,status}`,
  `conversations.{userId,agentId}`, `messages.{conversationId,userId}`,
  `documents.{agentId,userId,status}`. Additive, no behavior change.
  [src/db/schema.ts] This repo has no `drizzle/` migration history (schema
  changes are applied via `db:push`, not `generate`+`migrate` — confirmed
  by running `drizzle-kit generate`, which tried to emit a from-scratch
  `0000_*.sql` baseline rather than an index-only diff; deleted, not
  committed). **Requires `npm run db:push`** to actually apply, same as
  every prior schema change in this log — not exercised this session (no
  DB credentials).

### Verified but not touched this cycle (see Thinker/Decision-Maker below
for the full reasoning)
- **N6 — `meetingsProcessing` / `generateAgentQuestions` have the same
  unstepped-LLM-call gap** as `agentChatHandler` did. `summarizer.run()`
  (meetings) and `questionGenerator.run()` (agent questions) are both
  raw, uncaught calls. For `generateAgentQuestions` the blast radius is
  low (no polling UI blocks on `agents.lastResponse`). For
  `meetingsProcessing` it's real: `meetingStatus` enum has no `"failed"`
  value at all (`upcoming|active|processing|completed|cancelled`), so
  fixing this properly needs a schema change, not just a try/catch — out
  of scope for this cycle's "small" bar. **Next-cycle candidate.**
- **Orphaned Qdrant vectors on agent cascade-delete.** `documents.remove`
  does clean up Qdrant (best-effort, already logged as accepted risk in
  earlier cycles), but deleting an **agent** cascades its `documents` rows
  in Postgres with no corresponding Qdrant cleanup hook — those vectors
  leak permanently. Distinct from the already-tracked "best-effort delete
  can fail silently" risk. Real but not urgent (storage/cost concern, not
  correctness) — next-cycle candidate, needs an Inngest hook on agent
  delete or a periodic reconciliation job.
- **`documents.create` has no idempotency key on its Inngest dispatch**
  (unlike `meetings/processing`, which uses one). A client-side retry of
  the mutation could double-enqueue `documents/process`, producing
  duplicate chunks/vectors for the same file. Low severity (duplicate
  data, not corruption) — cheap fix (`inngest.send({id: `document-process-
  ${documentId}`, ...})`), deferred only because this cycle's bug budget
  was already spent on higher-impact items.
- **C3 (Qdrant threshold tuning)** — the score-logging groundwork from the
  prior uncommitted session (`[rag-scores]` line, `functions.ts`) is still
  present and still uncommitted alongside this cycle's changes; still
  blocked on real production log data, unchanged.
- **C4/C5 (embedding.ts native rewrite, no query-embed cache), B3 (rich
  doc status UI), item 13 (avatar consolidation)** — carried forward
  unchanged, still deferred pending live-env verification or real usage
  data, per every prior cycle.

### Rejected
- **Fixing `meetingsProcessing`'s unstepped LLM call in this cycle** —
  rejected for now specifically because it requires adding `"failed"` to
  `meetingStatus` first (a schema change), which changes the shape of this
  cycle's fix from "wrap in try/catch" to "schema migration + try/catch +
  verify nothing reads the enum exhaustively elsewhere." Correct call
  next cycle, not a "small" fix this cycle.
- **Full DB-index composite/covering-index tuning** — rejected as
  premature. Single-column indexes address the "full scan on every FK
  lookup" class; composite indexes should wait for real query-plan
  evidence (`EXPLAIN`) once there's production data volume, not guessed
  up front.

### Verification
- **Compiled**: tsc 0 errors. `npm run build`: green (confirmed this
  session, not just carried from a prior cycle's claim).
- **Not functionally exercised this session** (no live DB/Qdrant/Inngest
  credentials available). Live-env checklist:
  1. `npm run db:push` — confirm the 9 new indexes appear
     (`\d+ meetings` etc. in psql, or check Neon's index list).
  2. Reassign a meeting's `agentId` via a raw tRPC call to an agent owned
     by a different user — confirm `NOT_FOUND` instead of silent success.
  3. Temporarily break `fileUrl` (point at a 404) on a document upload —
     confirm the document ends at `status: "failed"` with a populated
     `error`, not stuck at `"processing"`.
  4. Temporarily set an invalid `GEMINI_API_KEY` and send a chat message —
     confirm a reply row still arrives ("Sorry, I couldn't generate a
     reply...") instead of the typing indicator spinning forever.
  5. Manually create the `agents` Qdrant collection with the wrong vector
     size, then trigger any embed/chat path — confirm a thrown, descriptive
     error instead of a silent collection wipe.

### Trend note
Two "stuck forever, no error surfaced" instances found this cycle
(document processing, chat reply) are the same shape as N1/N2 from cycle
4 (silent-failure surface) — that class was called "partially closed" in
cycle 4's trend note, and this cycle shows it wasn't: the pattern was
fixed at the two sites flagged then, but two *new* call sites (the LLM
`.run()` calls themselves, as opposed to the Qdrant retrieval around them)
had the identical gap. **Silent/stuck-failure surface should be treated as
still-open, not closed** — a third recurrence (`meetingsProcessing`,
already identified above as N6) is expected next cycle. Worth a shared
`runAgentStep(fn, fallback)`-style helper once that third instance lands,
per the existing "two instances don't justify the abstraction yet" rule
used elsewhere in this log.

The authz-gap class (G1/G2/G3) also recurred once more despite cycle 3's
"trust boundaries closed" verdict — same root cause noted then (no
compile-time enforcement that a new/changed writer touching a foreign id
calls its assert), same mitigation available (there's no lint rule or
type-level guard forcing this; it depends on the sweep catching it). If a
4th instance appears, that's the signal to stop relying on manual sweeps
and add a repo convention check.

---

## Fix — C3 score logging (prep, not tuning) — 2026-08-01
### Scope
C3 was flagged as "next-cycle candidate" but required real score-log
data before any threshold could be picked. This fix adds the logging;
tuning happens in a later session once data has been collected.

### Built
- Chat RAG handler now fetches `limit: 10` from Qdrant with no
  `score_threshold`, then filters at 0.5 in TS. Effective behavior
  identical (still top-5 above 0.5 in the LLM prompt). New difference:
  we see the *pre-filter* score distribution.
- One structured log line per chat request, greppable by prefix:
  ```
  [rag-scores] agent=<id> threshold=0.5 raw=[0.82,0.71,0.63,0.48,0.31,...] kept=3
  ```
  Aggregating these over N chat requests gives the score distribution
  needed to answer "is 0.5 the right threshold?"
- `SCORE_THRESHOLD` extracted to a local const so the tuning change is
  a one-line edit later. [src/inngest/functions.ts]

### Not touched
- **Interview session context builder** in `webhook/route.ts` uses
  `qdrant.scroll()` — no similarity scores, just grabs first 20 chunks
  matching the agent filter up to 6KB. That's a different retrieval
  mode with a different tuning story ("should sessions do similarity
  vs a whole-doc dump?") — separate concern, not part of C3.

### Verification
- **Compiled**: tsc 0 errors; `npm run build` green.
- **Functionally verifiable in prod**: after some real chat usage,
  `grep '\[rag-scores\]' <logs>` yields the raw score arrays. Plot as
  a histogram; pick a new threshold if the current 0.5 is cutting
  useful chunks or admitting garbage.

### Notes
- C3 remains open but is now *unblockable* — once you have a week or
  two of production `[rag-scores]` lines, running a one-liner (`awk` or
  a quick script) over them produces the distribution needed to tune.
- Deferred items unchanged. Nothing new added.

---

## Fix — N5 env validation at boot — 2026-08-01
### Scope
Not an audit cycle. Direct fix of the N5 item flagged in cycle 4 as the
next-cycle candidate, picked over C3 (which needs live score-log data
before it can be tuned). One-shot: shared env schemas, swap all direct
`process.env.X!` reads, fail fast at module load.

### Built
- **`src/lib/env.ts`** — server env, Zod-validated at module load,
  guarded by `import "server-only"`. Required: `DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `STREAM_VIDEO_SECRET_KEY`, `QDRANT_URL`. Optional: `BETTER_AUTH_URL`,
  `QDRANT_API_KEY`, `GITHUB_CLIENT_{ID,SECRET}`,
  `GOOGLE_CLIENT_{ID,SECRET}` (OAuth is optional; missing → that
  provider gets disabled, app boots).
- **`src/lib/env.public.ts`** — public env for client + server.
  Required: `NEXT_PUBLIC_STREAM_VIDEO_API_KEY`. Optional:
  `NEXT_PUBLIC_APP_URL`. Explicit per-key reads so Next's build-time
  inlining works on the client (a spread of `process.env` would be
  `undefined` there).
- Swapped all 8 direct `process.env.X!` reads to typed `env.X` /
  `publicEnv.X`:
    - `src/db/index.ts` (DATABASE_URL)
    - `src/lib/qdrant.ts` (QDRANT_URL, QDRANT_API_KEY)
    - `src/lib/embedding.ts` (GEMINI_API_KEY)
    - `src/lib/stream-video.ts` (STREAM_VIDEO_SECRET_KEY,
      NEXT_PUBLIC_STREAM_VIDEO_API_KEY)
    - `src/utils/web-crawler.ts` (GEMINI_API_KEY)
    - `src/app/api/webhook/route.ts` (OPENAI_API_KEY)
    - `src/inngest/functions.ts` (GEMINI_API_KEY × 3 in agent-kit calls)
    - `src/modules/call/ui/components/call-connect.tsx`
      (NEXT_PUBLIC_STREAM_VIDEO_API_KEY via publicEnv)
- **Left as-is**: `src/lib/auth.ts` still reads `GITHUB_CLIENT_*` and
  `GOOGLE_CLIENT_*` directly via `as string` casts. Those are consumed
  by better-auth's OAuth setup — env.ts flags them as optional so a
  missing OAuth provider doesn't crash boot, but the direct reads inside
  auth.ts are fine because they're internal to better-auth's config.

### Failure semantics
Before: `process.env.X!` — undefined at runtime silently coerced to
`undefined`, downstream libraries throw with confusing messages ("apiKey
must be a string", "invalid URL", etc.), sometimes only on first request
to a specific route.

After: process refuses to start. Boot-time error names every missing var
in one message. Example:
```
Invalid server environment variables:
  QDRANT_URL: Required
  GEMINI_API_KEY: Required
Copy .env.example to .env and fill in the missing values.
```

### Verification
- **Compiled**: tsc 0 errors; `npm run build` green.
- **Functionally verifiable locally**: temporarily comment
  `QDRANT_URL=` in `.env`, run `npm run dev`, confirm boot fails with
  the field-level error. NOT exercised this session.

### Notes for next cycle
- Trend note carried from cycle 5: audit cadence should pause. This fix
  was targeted, not a scheduled cycle — Phase 3 of the plan discussed
  before this ran.
- Next moves per the plan: shift to trigger-only audit, use bandwidth
  for feature work or (once real score logs exist) C3 Qdrant threshold
  tuning.
- Deferred items still open (unchanged by this fix):
  - Cycle 2.5 items 4 (embedding rewrite), 13 (avatar consolidation)
  - A8 (Qdrant collection wipe on dim mismatch)
  - A12, A13 (missing DB indexes)
  - A16 (crawler telemetry)
  - B3 (rich doc status UI)
  - C3 (Qdrant threshold tuning — needs score logs)
  - C4/C5 (pdf memory, no query embed cache)

---

## Cycle 5 — External-boundary type safety — 2026-08-01
### Scope
New class per cycle-4 trend note. Focus: untyped casts at external
boundaries (Inngest event payloads, Qdrant `payload as`, webhook `payload
as CallXEvent`), plus loose Zod inputs on tRPC.

### Fixed this cycle
- **T2 — Inngest event schemas centralized.** New `src/inngest/events.ts`
  exports one Zod schema per event, an `EventName` union, an
  `EventData<K>` inference helper, and a `parseEvent(name, data)`
  runtime validator. Every handler in `src/inngest/functions.ts` now
  calls `parseEvent("<event>", event.data)` at entry:
    - `meetings/processing`
    - `agents/questions`
    - `agents/generate-embeddings`
    - `agents/crawl-urls`
    - `agent/message`
    - `documents/process`
  Drift between a dispatcher and a handler now surfaces as a thrown
  ZodError inside the step — Inngest's dashboard picks it up cleanly and
  applies normal retry/backoff. Zero cast sites remain in handlers.
- **T3 — Shared Qdrant payload type.** New `AgentVectorPayload` type
  exported from `src/inngest/functions.ts`. Consumed by:
    - `agentChatHandler`'s RAG retrieval (both `sources` map + context
      builder)
    - `webhook/route.ts` `buildAgentSessionContext`
  Writer sites (URL + document pipelines) continue to compose the shape
  literally; if a future writer adds/renames a field, TypeScript flags
  the readers.
- **T4 — Tightened `documents.create` Zod input:**
  `fileUrl` now `.url()` (was `z.string()`); `agentId`, `fileName`,
  `mimeType` now `.min(1)`; `fileSize` now `.int().nonnegative()`.
  Non-URL `fileUrl` used to become a confusing `fetch` error inside
  Inngest — now a clean 400 at the boundary. [src/modules/documents/server/procedures.ts]

### Deferred (explicitly out of scope)
- **T1 — Webhook `payload as CallXEvent` casts.** Stream is a stable
  API; retrofitting Zod for its own sake is over-engineering. Address
  when Stream ships a schema change or a fuzzed body starts producing
  500s in logs.
- **T5 — `JSON.parse(metadata) as {...}` in agent-chat.tsx.** Our own
  data; risk is minimal.
- **Broader Zod tightening** across every `z.string()` id / search
  input. Cosmetic; the ones that mattered (`documents.create`) landed.
- **Inngest typed-client migration** (`Inngest<{...}>`). Would formalize
  what `EventSchemas` already gives us at the type level, but requires
  touching every `inngest.send` site. YAGNI until it pays for itself.

### Verification
- **Compiled**: tsc 0 errors; `npm run build` green.
- **Functionally exercised**: NOT this session. Live-env checklist:
    1. Dispatch a valid event (`documents/process` via a real upload) —
       handler runs as before.
    2. From an Inngest test harness or a script, dispatch an event with
       a bad shape (e.g. `documents/process` missing `mimeType`) —
       confirm the handler fails with a ZodError visible in the Inngest
       dashboard rather than a deeper runtime error.
    3. Attempt `documents.create` from tRPC devtools with
       `fileUrl: "not-a-url"` — confirm a 400 with a field-level
       validation error, not a downstream Inngest fetch failure.

### Trend note
Cycle 5 addressed the T2/N4 recurrence (Inngest cast pattern flagged in
cycle 4 as "watch for it") by fixing at the class level rather than site
by site. The shared `parseEvent` + `AgentVectorPayload` are load-bearing:
new events/writers now converge on the shared shape by construction.

Cluster status across cycles:
- Trust boundaries → closed (`assertAgentOwned`).
- Dead code / orphan deps → closed.
- Silent-failure surface → partially closed (chat + interview logs
  greppable, cluster helper deferred until 3rd instance).
- External boundary types → closed for Inngest + Qdrant this cycle.

**Next candidate class:** operational readiness (env validation at
boot; N5 still open) or performance instrumentation (Qdrant
`score_threshold` tuning needs real score logs — C3 still open).

---

## Cycle 4 — Silent-failure surface in background jobs — 2026-08-01
### Scope
New class per cycle-2.6 trend note ("scan for a new class"). Focus: silent
correctness degradation in Inngest handlers + webhooks + concurrent-crawl
races. Not authz (closed cycle 3), not dead code (closed cycle 2.6).

### Fixed this cycle
- **N1 — Chat RAG retrieval failure now surfaces to the user.**
  `agentChatHandler` catches Qdrant failures with a fallback (as before)
  but now persists `retrievalError` on `messages.metadata` alongside
  `sources`. Log line changed to a greppable `[chat-rag-fallback]` prefix.
  Chat UI renders a small amber "Sources unavailable — reply is from
  instructions only." warning beneath the affected reply.
  [src/inngest/functions.ts:471, src/modules/agents/ui/components/agent-chat.tsx]
- **N2 — Interview session RAG fallback log now greppable.**
  `buildAgentSessionContext` still returns empty context on failure (the
  interview can't be blocked on a lookup miss), but the log line uses a
  `[interview-rag-fallback]` prefix with agent id, so ops can find silent
  regressions without spelunking through raw stack traces.
  [src/app/api/webhook/route.ts:44]
- **N3 — `agents.recrawlUrls` in-flight guard.** Reads current
  `urlsStatus`; if `pending|processing`, throws `TRPCError CONFLICT`
  ("A crawl is already in progress for this agent."). UI already disabled
  the button in that state; server now enforces so direct API callers
  can't double-fire the expensive crawl job.
  [src/modules/agents/server/procedures.ts]

### Verification
- **Compiled**: tsc 0 errors, `npm run build` green.
- **Functionally exercised**: NOT this session (needs live Inngest +
  Qdrant to trigger the fallback paths). Live-env checklist:
    1. In agent chat, temporarily point QDRANT_URL to a bad host; send a
       message; confirm the reply arrives AND the amber "Sources
       unavailable" chip renders beneath it.
    2. Grep server logs for `[chat-rag-fallback]` and
       `[interview-rag-fallback]` — should be the only markers when RAG
       silently falls back.
    3. In the URL panel, click Re-crawl; while status is still
       `processing`, POST a second recrawl via curl — confirm it returns
       CONFLICT and doesn't spawn a second Inngest run.

### Deferred (explicitly out of scope)
- **N4 — Untyped Inngest events.** 5 handlers cast `event.data as {...}`.
  No live bug; retrofitting typed events for its own sake is over-
  engineering. Adopt when a new event is added, at that event's PR.
- **N5 — Env var validation at boot.** 8 `process.env.X!` sites; missing
  vars surface as 500s on specific routes rather than a clean boot
  failure. Wants a `src/lib/env.ts` with Zod schemas — cycle 5 candidate,
  needs care around NEXT_PUBLIC_ vs server-only vars and Next's
  edge/serverless boundary.
- **A16 — Crawler per-URL failure telemetry.** Still open, still low
  priority.
- **Items 4 + 13 from cycle 2.5** — still waiting on live-env verification
  (behavior changes).

### Trend note
Cycles-to-date classes:
- Cycles 1-3: trust boundaries → closed (`assertAgentOwned`).
- Cycles 2.5-2.6: dead code / orphan deps → closed.
- Cycle 4: silent-failure surface → partially addressed (2 concrete
  instances patched, pattern documented).

The silent-failure class is *shape-similar* to the trust-boundary class:
both are "the same defensive pattern applied inconsistently across many
call sites." N1 and N2 were the two live instances; N3 is a related-but-
different race that got bundled. If a third silent-failure instance shows
up in cycle 5 or 6, treat it as class-level and consider a shared
`fallbackWithTelemetry(name, fn, fallback)` helper — for now, two
instances don't justify the abstraction.

Next candidate class to scan: **type safety at external boundaries**
(N4 + webhook signature payload types + tRPC input schemas that accept
`z.string()` where a `z.string().url()` or enum would be tighter).

---

## Feature — Chat UX polish (formerly B7 debug tool) — 2026-08-01
### Follow-up rename (same day)
Debug-era "test" naming was still surviving in identifiers after the UX
polish landed. Renamed to match the product-shaped user text:
- `TestAgent` → `AgentChat` (component)
- `test-agent.tsx` → `agent-chat.tsx` (file; `git mv` to preserve history)
- `conversations.getOrCreateTest` → `conversations.getOrCreateChat` (tRPC)
- `<TabsTrigger value="test">` / `<TabsContent value="test">` →
  `value="chat"` (both paired)
Kept: DB conversation title marker `"__test__"`. It's an invisible internal
identifier (filtered from `conversations.getMany`); renaming it would
orphan existing rows in real databases without any user-facing benefit.
The `getOrCreateChat` handler carries a comment explaining why.

### Spec
Redesigned the existing `TestAgent` component from a debug-shaped panel
into a real "chat with your documents" experience. Owner-only, same
retrieval/backend, same tab location. Server code untouched.

Concrete before → after:
- Tab renamed **Test → Chat**.
- Header uses the agent's avatar + name ("Chat with {agentName}") instead
  of generic debug copy.
- Empty state is a centered greeting keyed to agent name, not a debug
  hint line.
- User bubbles: raw `bg-blue-500` → semantic `bg-primary text-primary-
  foreground` with `rounded-2xl` and asymmetric bottom-right (`rounded-br-sm`).
- Agent bubbles: raw `bg-gray-100` → semantic `bg-muted`, with the agent's
  avatar next to the bubble, asymmetric bottom-left.
- Agent reply content: plain text → rendered via `react-markdown` (already
  installed; same components map as `meetings/completed-state.tsx` so the
  language matches the rest of the app).
- Sources: raw bullet list exposing scores → collapsed "Show N sources"
  toggle → citation chips as `Badge`s with file/link icon and truncated label.
  Scores no longer surfaced (debug detail, not user info).
- Loading (waiting for reply): spinner + "Agent is thinking…" → three-dot
  pulsing typing indicator inside a muted bubble, left-aligned with avatar
  — recognizable metaphor.
- Input: single-line `<Input>` → auto-growing `<textarea>` (max 160px),
  `Enter` sends, `Shift+Enter` newline, keyboard hint line beneath.
- Send button: rounded pill → circular icon button inside a bordered pill
  containing the textarea (composed input group).
- Entry animation: new messages fade + slide in via `tw-animate-css`
  utilities (already imported globally).

Explicit owner-vs-candidate decision: **owner-only stays**. Candidate
access requires a different authz model (shared-link tokens, no
`assertAgentOwned`); scope separately if wanted.

### Built this cycle
- `src/modules/agents/ui/components/test-agent.tsx` — full component
  rewrite. Now takes an `agentName` prop; renders greeting/header/typing/
  bubbles with semantic tokens; markdown-renders agent replies; sources
  collapsed with per-message toggle; auto-growing textarea; keyboard hints.
- `src/modules/agents/ui/views/agent-id-view.tsx` — tab label
  `Test` → `Chat`; passes `agentName={data.name}` into `<TestAgent>`.

### Verification
- **Compiled**: tsc 0 errors; `npm run build` green.
- **Functionally exercised**: NOT this session. This is a visual redesign;
  a green build says nothing about whether it looks right. Live-env
  checklist:
    1. Open an agent detail page → Chat tab.
    2. Confirm greeting empty state renders with agent name + sparkles icon.
    3. Send a message — confirm user bubble appears immediately, right-
       aligned, in primary color; three-dot typing indicator appears below.
    4. Wait for reply — confirm agent bubble replaces the indicator,
       left-aligned with the agent avatar; if the reply uses **bold** or
       `- lists`, confirm markdown renders.
    5. Confirm a "Show N sources" toggle appears under the reply (assuming
       the agent has any docs/URLs indexed); click it and confirm chip
       badges render with a file/link icon and readable label.
    6. Try Enter (sends), Shift+Enter (newline in textarea), and confirm
       the textarea auto-grows up to ~6 rows, then scrolls.
    7. Confirm no console errors and no layout shifts on the surrounding
       tabs (Details, Knowledge Base).

### Deferred (explicitly out of scope this increment)
- **Streaming token-by-token responses.** Still polling at 1.5s. Would
  require server-side changes (SSE or WS from Inngest) — much larger
  scope, separate feature.
- **Candidate-facing access.** Different authz model (shared-link tokens,
  no `assertAgentOwned`). Scope separately.
- **Dedicated full-page `/agents/[id]/chat` route.** The tabbed context
  proved fine visually; a full-page route is a structural change to defer
  until there's evidence the tabbed panel isn't enough.
- **Suggested starter questions.** Would need a new procedure and probably
  an LLM call per agent; nice-to-have.
- **Backend / retrieval changes.** Untouched by intent.
- **Item 4 (embedding.ts native rewrite)** and **Item 13 (avatar
  consolidation)** from cycle 2.5 still deferred pending live-env
  verification.

### Notes
- Markdown components map is duplicated between
  `meetings/completed-state.tsx` and `test-agent.tsx`. If a third markdown-
  rendering site appears, promote to a shared `<AgentMarkdown>` component.
  Two call sites don't yet justify the extraction — YAGNI.
- The `messages.metadata` column (added for B7 in the previous cycle) is
  now consumed by two paths: the polling loop that reads it into the
  chat's Sources chip row, and any future debug panel. Its JSON shape
  (`{ sources: [{fileName?, url?, section?, score?}] }`) is a small ad-hoc
  contract worth codifying as a shared TS type if a third reader shows up.
- The `showSourcesFor` state is per-index. If messages ever get real
  stable ids on the client (they don't today — `getMessages` returns
  indexed rows), key sources open-state on message id instead of index
  to survive reorders/pagination.

---

## Feature — B6 URL re-crawl — 2026-08-01
### Spec
New "Crawled URLs" panel on the agent detail page (under Knowledge Base)
listing the agent's URLs, a per-agent crawl status badge, and a **Re-crawl**
button. Both agent creation and manual re-crawl now dispatch to a single
Inngest function (`agents/crawl-urls`) — no more sync Playwright in a tRPC
mutation. Re-crawl **replaces** all prior URL-sourced vectors for the agent
(discriminator: Qdrant filter `must agentId=X + must_not documentId exists`),
then re-embeds via the existing `agents/generate-embeddings` pipeline.

Scope boundary: single per-agent status flag (`idle|pending|processing|
completed|failed`) + `urlsUpdatedAt` timestamp — no per-URL state, no diffing
which URLs changed, no auto-recrawl on URL edit.

### Built this cycle
- **Schema**: added `urls_status` enum + `agents.{urlsStatus, urlsUpdatedAt,
  urlsError}` columns. Requires `npm run db:push` locally (no DB creds this
  session). Additive; existing rows default to `idle` / NULL. [src/db/schema.ts]
- **Inngest**: new `crawlAgentUrls` function on event `agents/crawl-urls`
  — marks processing, clears prior URL vectors from Qdrant, launches
  Playwright with a `finally { browser.close() }`, dispatches
  `agents/generate-embeddings` for the results, marks completed/failed with
  timestamp + error. Registered in `/api/inngest/route.ts`.
  [src/inngest/functions.ts]
- **tRPC**:
  - `agents.create` — sync crawl block **removed**. Now writes the agent
    with `urlsStatus: "pending"` if URLs are provided, then dispatches
    `agents/crawl-urls`. Also removed unused `playwright`/`crawlWebsitePlaywright`
    imports at the top of the file.
  - `agents.recrawlUrls(id)` — new mutation, gated by `assertAgentOwned`.
    Reads current URLs from DB, marks pending, dispatches crawl event.
  - [src/modules/agents/server/procedures.ts]
- **UI**: `src/modules/agents/ui/components/agent-urls.tsx` — panel with
  URL list, status badge, Re-crawl button (disabled while in-flight or if
  no URLs), and last-crawled timestamp. Polls `agents.getOne` every 3s
  only while `urlsStatus ∈ {pending, processing}`. Wired into the Knowledge
  Base tab.
- **A11 fix**: `crawlWebsitePlaywright` now wraps the page's `goto` +
  `content` + `$$eval` in a `try { ... } finally { await page.close() }`, so
  a throw between `newPage` and the extraction no longer leaks the page.
  [src/utils/web-crawler.ts]
- **Ownership**: only new writer is `agents.recrawlUrls`; uses
  `assertAgentOwned` per cycle-3 rule.

### A10/A11 status
- **A10 CLOSED**: no remaining call site launches Playwright inside a
  request-path handler. Both flows (create + re-crawl) dispatch to
  `agents/crawl-urls` and return immediately.
- **A11 CLOSED**: `page.close()` is now in a `finally` (also `.catch(() => {})`
  so a close-time error doesn't mask the primary throw).

### Verification
- **Compiled**: tsc 0 errors; `npm run build` green.
- **Functionally exercised**: NOT this session. Needs (1) `db:push` to add
  the three columns, (2) a live agent with URLs, (3) live Inngest to run
  `crawlAgentUrls`, (4) live Qdrant to observe delete + upsert. Checklist:
    1. `npm run db:push`
    2. Create an agent with 1–2 URLs; confirm mutation returns quickly and
       Knowledge Base → Crawled URLs shows `pending → processing → completed`.
    3. Click Re-crawl on the same agent; watch the badge cycle again,
       confirm `urlsUpdatedAt` refreshes.
    4. On the Test tab, ask a question that only URL content answers;
       confirm the reply cites those sources (no `fileName` — only `url`).
    5. Delete a URL, save, Re-crawl; ask a question about the removed
       URL's content — should return "I don't know" (proves delete cleared
       old vectors).

### Deferred (explicitly out of scope this increment)
- **Per-URL status** (each URL as its own row with individual retry). Would
  need an `agent_urls` table — disproportionate until per-URL failures
  actually cause debugging pain.
- **Diff / partial re-crawl** — always re-crawls the full list.
- **Auto-recrawl on URL edit** — user must click Re-crawl explicitly.
- **Streaming per-page crawl progress** — polling every 3s is enough.
- **A8** (Qdrant collection-wipe on dimension mismatch) — untouched; still
  a global-blast concern on any embed-model change.
- **Legacy URL points from prior crawls** are already excluded from the
  "docs" set via the `must_not documentId` filter, so the delete-then-insert
  semantic works today. Optional future cleanup: tag all URL points with
  `sourceType: "url"` explicitly.

### Notes
- `agents/crawl-urls` and `agents/generate-embeddings` are now two links in
  a chain: the first dispatches the second. Any future "crawl only" or
  "embed only" callers plug into the same pipeline without duplicating the
  Playwright launch. If a *third* caller for `agents/generate-embeddings`
  appears (e.g. a "bulk import" tool), the shared event contract already
  handles it.
- The new `urls_status` enum shares shape with `document_status` but is a
  separate type. If a third `*_status` shows up, consider consolidating —
  for now, two independent enums beats a shared abstraction.
- `agents.recrawlUrls` throws `BAD_REQUEST` if the agent has no URLs — the
  UI's disabled state should keep this from ever hitting, but the server
  guard makes it safe against manual clients.

---

## Feature — B7 Test my agent — 2026-08-01
### Spec
A "Test" tab on the agent detail page that exercises the RAG chat pipeline
end-to-end without needing a real interview. On first message it creates (or
reuses) a hidden `__test__` conversation for the current user + agent, sends
via the existing `messages.addMessage` → `agent/message` Inngest → agent reply
flow, and renders both the reply and the list of document chunks the agent
retrieved for that turn. This is a debug tool first, not a chat product.

Scope boundary: reuses the real `conversations`/`messages` tables (title
`__test__` filtered out of `conversations.getMany`). Does not expose relevance
scores as a chart, does not stream, does not surface latency/token metrics.

### Built this cycle
- **Schema**: added nullable `messages.metadata TEXT` column. Requires
  `npm run db:push` locally — session has no DB creds so this is documented
  rather than executed. Column is additive; existing rows are NULL. [src/db/schema.ts:96]
- **Handler**: `agentChatHandler` now returns retrieval `sources`
  (`fileName, url, section, score`) from the RAG step and persists them as
  `JSON.stringify({sources})` in the agent-reply row's `metadata`. Non-RAG
  turns leave `metadata` NULL. [src/inngest/functions.ts]
- **tRPC**:
  - `conversations.getOrCreateTest(agentId)` — new mutation, gated by
    `assertAgentOwned`. Returns existing `__test__` conversation for
    user+agent or creates one. [src/modules/conversations/server/procedures.ts:101]
  - `conversations.getMany` — hides `__test__` conversations from normal
    listings (title != "__test__" in both data + count queries).
  - `messages.getMessages` — now returns `{sender, metadata, ...}` and fixes
    the `fromSelf` calc: was based on `userId === ctx.auth.user.id`, which
    since cycle 2's FK fix was true for both user and agent messages
    (agent replies borrow the owner's userId). Now uses `sender === "user"`.
    Incidental correctness fix that also happens to matter for the real chat UI.
- **UI**: `src/modules/agents/ui/components/test-agent.tsx` — panel with
  message list, per-agent-reply "Retrieved N sources" section, per-file badge,
  input + Send. Polls `getMessages` only while the last message is the user's
  (i.e. waiting for the reply). New "Test" tab wired into agent detail page.
- **Ownership**: only new writer added is `conversations.getOrCreateTest`,
  which calls `assertAgentOwned` first — cycle-3 helper reused as required.

### Verification
- **Compiled**: tsc 0 errors, `npm run build` green.
- **Functionally exercised**: NOT this session. Requires (1) `db:push` to add
  the metadata column, (2) live Qdrant with real embeddings for an agent
  that has uploaded documents, (3) live Inngest to run `agentChatHandler`.
  Live-env checklist:
    1. `npm run db:push` to add `messages.metadata`.
    2. Create an agent, upload a document (existing KB tab).
    3. Wait for `processDocumentEmbeddings` to complete (status → completed).
    4. Open Test tab, ask a question referencing the doc content.
    5. Confirm reply arrives and "Retrieved N sources" lists the doc filename
       with a score.
    6. Confirm the `__test__` conversation is NOT visible in `/conversations`.

### Deferred (explicitly out of scope this increment)
- **Streaming replies** — polling every 1.5s while waiting is enough for a
  debug tool.
- **Full metrics** — no LLM latency, token count, or per-step timing yet.
  Add when a retrieval failure investigation actually needs them.
- **Multi-turn context in retrieval** — retriever still uses only the current
  user message; conversation history isn't embedded. Existing production
  behavior; not this feature's job to change.
- **Reset / delete test conversation** — no button today. Delete via
  `/conversations/[id]` if it becomes noisy (though it's hidden from listings).
- **Item 4 (embedding.ts rewrite)** and **Item 13 (avatar consolidation)**
  from cycle 2.5 remain deferred pending live-env verification.

### Notes
- The `messages.metadata` column is now a general hook for future features
  needing per-message side data (per-chunk scores in a real debug panel,
  audit trails, moderation flags). Next audit cycle should look at it once
  a second reader exists.
- The `__test__` title-string filter is a quiet coupling: any change to how
  test conversations are marked has to update the `ne(title, "__test__")`
  filters in `conversations.getMany`. Cheap now (two lines, one file); if a
  third reason to hide a conversation shows up, promote to a boolean column
  (`isHidden` or an enum).
- `messages.getMessages`'s `fromSelf` was wrong in a way no existing UI
  currently exercises the corrected side of (the real chat UI's chat-connect
  renders both sides via `fromSelf`, so before this fix agent replies also
  rendered as the user's own messages — likely a latent bug in the real
  chat page too, now fixed as a side effect).

---

## Cycle 2.6 — Cleanup (orphaned deps + stragglers) — 2026-08-01
### Scope
Second ponytail-audit sweep, one cycle after 2.5. Finds what 2.5 didn't:
orphaned deps left behind when files were deleted, plus a few stragglers.

### Fixed this cycle
- **19 deps uninstalled** (cycle 2.5 deleted the files but left the deps):
  `@radix-ui/react-{accordion, alert-dialog, aspect-ratio, checkbox,
  collapsible, context-menu, hover-card, menubar, navigation-menu, progress,
  radio-group, slider, toggle, toggle-group}`, `input-otp`,
  `embla-carousel-react`, `react-day-picker`, `react-resizable-panels`,
  `recharts`. All had zero source importers.
- **`src/components/ui/toggle.tsx` deleted** (47 lines, zero importers).
  Toggle-group was already deleted in 2.5; solo toggle was left behind.
- **`auth-schema.ts` at repo root deleted** (47 lines, zero importers).
  Duplicated the auth tables already in `src/db/schema.ts` — better-auth
  generator output that was manually merged and never cleaned up.
- **`PageData` and `ChunkResult` interfaces inlined** in `src/inngest/functions.ts`.
  Each had a single use site; inlined the shapes at their call site. Net −10 lines.

**Net measured impact:**
- Files: 2 deleted, 1 modified (functions.ts inlines).
- Source lines: **~−104 net** (−47 auth-schema + −47 toggle + −10 inlines).
- Deps removed: **19**.
- tsc: 0. Build: green.

### Deferred / rejected
- Nothing new deferred this cycle.
- Items 4 (embedding.ts rewrite) and 13 (avatar consolidation) from 2.5 still
  waiting on live-env functional verification.

### Trend note
Cleanup class: cycle 2.5 focused on *code deletion*, cycle 2.6 on the *deps
those deletions orphaned*. Combined with cycle 3's authz work, all three
classes tracked over these cycles (trust boundaries, dead code, orphan deps)
are now at zero known instances. Next audit cycle should scan for a *new*
class rather than repeating these three.

---

## Cycle 3 — Trust-boundary authz sweep — 2026-08-01
### Scope
Dedicated authz sweep as promised at end of cycle 2. Enumerated every tRPC
procedure, Inngest handler, and route handler; verified ownership at each.

### Fixed this cycle
- **G1: `meetings.create`** — accepted client-supplied `input.agentId` without
  ownership check. Now calls `assertAgentOwned(input.agentId, ctx.auth.user.id)`
  before insert. [src/modules/meetings/server/procedures.ts:106]
- **G2: `conversations.create`** — same class as G1. Now calls
  `assertAgentOwned` before insert. Also removed the dead post-insert
  `select … where agents.id = X + throw NOT_FOUND` block (fetched nothing, threw
  on a case FK already guaranteed). Net −13 lines.
  [src/modules/conversations/server/procedures.ts:87]
- **Extracted shared helper**: moved `assertAgentOwned` out of
  `documents/server/procedures.ts` into new `src/lib/authz.ts`. Three call sites
  now share one implementation (documents.create, meetings.create,
  conversations.create). New writers referencing an `agentId` add one import.

### Full enumeration result
- **tRPC procedures**: 23 total. 21 already safe (own-userId filters or ctx-set).
  2 gaps (G1, G2) — both patched.
- **Inngest handlers**: 5 total. Each has its trust boundary held by the
  dispatcher; dispatchers all validated. No handler changes needed.
- **Route handlers**: 5 total. All gated (better-auth / tRPC middleware /
  Inngest sig / UploadThing session middleware / Stream sig).

### Trend note
The cluster is closed. Instances found across cycles:
- Cycle 1: docs.create, uploadthing.middleware, docs.remove (3)
- Cycle 2: chat.addMessage, meetings.genrateToken admin role, webhook
  idempotency (3)
- Cycle 3: meetings.create, conversations.create (2)
Total: 8 instances of the trust-boundary pattern found across 3 cycles.

Root cause was structural: no shared helper existed until now. With
`src/lib/authz.ts` in place, cycle 4+ should see this class approach zero —
any new writer that references a foreign key adds one import. Watch for the
class re-emerging on **new** resource types (documents already; agents/meetings/
conversations covered; anything new — analytics events, invites, org
memberships — will need its own `assertXOwned`).

### Verification
- tsc: 0 errors (still 0 since cycle 2.5's chart.tsx removal).
- npm run build: green.
- No functional test — writes are additive gates, existing owned-agent flow
  still works (assert passes for owner). Cross-tenant IDOR now returns 404.

---

## Cycle 2.5 — Cleanup — 2026-08-01
### Scope
Dead code / unused deps verification and removal (source: ponytail-audit scan).
Cleanup pass only — no trust-boundary work; the promised sweep still lands in cycle 3.

### Fixed this cycle
- **chart.tsx deleted** (353 lines). Zero importers. Also resolved the 8 pre-existing
  tsc errors carried as deferred debt since cycle 1 — remove that line from future
  cycles' deferred lists.
- **18 unused shadcn/ui primitives deleted**: `accordion, alert-dialog, aspect-ratio,
  calendar, carousel, checkbox, collapsible, context-menu, hover-card, input-otp,
  menubar, navigation-menu, pagination, progress, radio-group, resizable, slider,
  toggle-group`. Each verified as zero-importer.
- **`@langchain/community` dep removed**. Zero direct imports.
- **`ws-server.ts` deleted**, `trpc:ws` npm script removed, `ws` + `@types/ws` deps
  removed. The wsLink client was already commented out in `src/trpc/clients.tsx`;
  no code path referenced them. `ws` remains available transitively via other peers.
- **`openai-client.ts` deleted** + `openai` top-level dep removed. Zero direct imports;
  realtime uses `@stream-io/openai-realtime-api`. `openai` remains transitively.
- **Duplicate files removed**: `src/modules/agents/ui/components/data-table.tsx`,
  `src/modules/agents/ui/components/data-pagination.tsx` (both byte-identical dups
  of the root copies). One importer in `agents-view.tsx` redirected to
  `@/components/data-pagination`.
- **`use-confirm.tsx` consolidated** from `src/modules/{agents,meetings}/hooks/`
  (byte-identical) into shared `src/hooks/use-confirm.tsx`. Both import sites updated.
- **Junk imports removed** from `src/components/command-select.tsx`:
  `import { on } from "events"` and `import { se } from "date-fns/locale"`.
- **Dead imports removed** from `src/inngest/functions.ts`: unused `GeminiAI` and
  `openai` from `@inngest/agent-kit`.
- **`gemini-client.ts` inlined** into its single caller `src/utils/web-crawler.ts`
  (`new GoogleGenerativeAI(...)` — 2 lines).
- **`document-parser.ts` try/catch removed** (only did `console.error` + rethrow;
  Inngest already surfaces failures). Net -5 lines.
- **`MIN_PAGE_SIZE` constant inlined** as literal `1` at its 3 use sites. Note:
  ponytail audit claimed "one use site" — actually 3. Cut still valid.
- **Pre-existing scope-creep fixes needed to unblock the build gate** (not part of the
  audit, both landed pre-cycle-1 in commit `5135c3f`):
  - `src/app/chat/[conversationId]/page.tsx` — missing `export default Page;`
  - `src/app/chat/layout.tsx` — missing `export default Layout;`

**Net measured impact:**
- Files: 26 deleted, 1 added (shared use-confirm), ~10 modified.
- Source lines: **−2565 deleted / +60 added = −2505 net**.
- Deps removed: **4** (`ws`, `@types/ws`, `openai`, `@langchain/community`).
- tsc: 8 pre-existing errors → 0. Build: green.

### Deferred / rejected
- **Item 3, `@langchain/core` — rejected (false positive).** Believed transitive via
  `@langchain/google-genai`, but it's a *peer dep* of that package. Removing it broke
  `@langchain/google-genai/dist/chat_models.js` (missing `@langchain/core/output_parsers`).
  Reverted; will drop naturally once **item 4** lands and removes `@langchain/google-genai`
  entirely.
- **Item 4, `embedding.ts` rewrite — deferred to cycle 3.** Behavior change
  (different call path → potentially different vector dimensions/normalization).
  Rules require functional verification via a real document upload and RAG chat
  retrieval, which this session cannot execute (no live Qdrant/Inngest/user flow).
  Ships next cycle with an explicit test: upload a known PDF, embed both ways,
  compare vector output shape, confirm RAG chat still cites the doc.
- **Item 13, avatar consolidation — deferred to cycle 3.** Variant-name drift
  (`bottsNeutral` vs `botttsNeutral`) makes it a rendering-behavior change.
  Rules require visual before/after verification, which needs the dev server +
  browser + reproducing every seed. Callers of `generateAvatarUri` all pass
  `variant: "initials"` today (so the bots branch is unused via that path).
  Cleanest consolidation is: keep both file paths, but have `GeneratedAvatar`
  internally call `generateAvatarUri` to remove one dicebear switch. Ships next
  cycle after visual confirmation.

### Trend note
Carried forward unchanged from cycle 2: **the trust-boundary pattern still has
six instances across cycles 1 and 2**, so cycle 3 opens with the promised
dedicated authz-sweep before any new feature work. This cycle was cleanup only —
not a new instance and does not defer the sweep further.
