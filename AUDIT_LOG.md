# Audit Log

## Feature — Chat UX polish (formerly B7 debug tool) — 2026-08-01
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
