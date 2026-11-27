# Conventions for building a phase

Read this, `docs/SPEC.md` and `docs/DECISIONS.md` before changing anything. Copy the patterns of Phase 2 (`src/core/bank.ts`, `src/core/cash.ts`, `src/app/pages/Bank.tsx`, `src/app/pages/Cash.tsx`). Don't invent new ones.

## Architecture
- **`src/core/`** is pure TypeScript with no React. All accounting logic lives here and is unit-tested.
  - `types.ts` holds `BooksState`, the whole persisted state. Add your module's slice as one new field (e.g. `fuel: FuelState`) and initialize it in `emptyState()` in `src/data/seed.ts`.
  - `books.ts` is the `Books` class. Its writes are `books.createTransaction / updateTransaction / deleteTransaction`, plus `books.require(actor, permission, what)`, `books.audit(actor, {...})`, `books.changed()`, `books.nextId(prefix)` and `books.clock()`.
  - Module operations are plain functions `(books, actor, input)` in `src/core/<module>.ts`. Each one: checks permission with `books.require`, validates (throw `new ValidationError([...sentences that say how to fix it])`), mutates `books.state`, writes `books.audit(...)` with before/after, then calls `books.changed()`. Anything that affects the books posts through `books.createTransaction` so it's validated, balanced and period-locked.
  - Reports and derived numbers are pure functions `(state, opts) => result` that never mutate.
- **Ledger rules:** money is integer cents (`src/core/money.ts`: `formatMoney`, `parseMoney`, `allocate`). Dates are `'YYYY-MM-DD'` strings, America/Chicago (`src/core/dates.ts`). The intercompany lines that keep each entity balanced are added automatically. A `transfer` can't touch P&L accounts. Locked periods refuse writes. Add accounts to `src/core/coa.ts` (unique number, id `acct_*`, type/subtype/lob).
- **Permissions:** `src/core/permissions.ts`. Add new permissions to the matrix for every role, following SPEC §10.
- **Demo data:** `buildDemo()` in `src/data/seed.ts` posts everything through the real ledger, 1 Sep – 26 Nov 2026, deterministic via `rand()`. Put your module's seeding in its own file `src/data/seed-<module>.ts`, exporting `seed<Module>(ctx: SeedCtx)` (see `SeedCtx` in seed.ts), and register it in the `MODULE_SEEDS` array in `seed.ts`. Edit the main loop in seed.ts only when your module truly changes how existing demo transactions are generated (e.g. fuel), and keep every existing test passing. Demo data is illustrative: generic names (Owner A/B), round invented figures, no real account numbers.
- **UI:** `src/app/`.
  - Read state with `useBooks()`, which returns `{ state, books, user, stores, visible, lines, version }`. `state` is a fresh snapshot per change, so key `useMemo` on `state` or `version`. Write only through core functions.
  - Pages go in `src/app/pages/<Module>.tsx`. Routes go in `src/main.tsx`, nav in `src/app/components/nav.ts` (add a group in SPEC §3 order), help notes in `src/app/help.ts`, inbox items in `src/app/inbox.ts`, roadmap status in `src/app/pages/Roadmap.tsx`.
  - Shared components live in `src/app/components/ui.tsx`: `PageHead`, `Figure`, `Money`, `TieOut`, `Help`, `Errors`, `useToast`, `useExport`, `csvMoney`, `AccountOptions`, `PartyOptions`, `useIsPhone`.
  - Every page opens with 3–5 figures (the `.figures` row), then detail. Every report has a `<TieOut>` that genuinely computes its check; never a hard-coded ✓. Every list can export CSV. Use `className="table-wrap"` around tables, and `.num` for numbers.
- **Row-level access:** filter by `visible` (store ids). Corporate/bank data needs `visible.has(bankStoreId(state))`.

## Design ("Ledger")
Use the tokens in `src/styles.css` only, with no new colors or fonts. Newsreader for headings and big figures, Instrument Sans for UI, tabular numbers, negatives in parentheses (`formatMoney`), hairline borders, no shadows/gradients, 4–8px radius. Semantic `pos`/`neg`/`pill ok|warn|bad`. Copy is plain sentences from the CFO's side; errors say how to fix them. At 390 px wide nothing may scroll the page sideways (tables scroll inside `.table-wrap`). Inputs need labels (visible or `sr-only`). Zero axe violations.

## Tests (all must pass before you commit)
- `npx tsc --noEmit -p .` must be clean.
- `npx vitest run`: add `src/core/<module>.test.ts` covering the module's math, validation, permissions, tie-outs and the demo data (it loads and ties out).
- `PW_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=<your port> npx playwright test --reporter=line`. Add every new route to `ROUTES` in `e2e/screens.spec.ts` (axe + no sideways scroll at 390/1440, light/dark) and add at least one workflow test for your module's main job. The full run takes about 3 minutes, so run it in the background if your shell times out at 2.

## Docs
Append your phase to `docs/HOW-TO.md` (one short section per screen), add an entry at the top of `docs/DECISIONS.md` (decisions and limits), and update the README's phase list and table.

## Git
Commit on your current branch with a clear message ending in the attribution lines your instructions give you. Don't push, and don't touch other branches.
