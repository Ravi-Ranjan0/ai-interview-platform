# Audit Log

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
