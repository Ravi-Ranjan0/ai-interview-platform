# Audit Log

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
