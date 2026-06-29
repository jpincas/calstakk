# Gotchas

Stack-specific traps. One file, organised by area. Hand-maintained — capture
new traps as you hit them, in the relevant area heading.

`make check` enforces what it can; everything in this file is a trap that the
gate doesn't catch (or can't easily). Read the area heading for the tool
you're about to touch before improvising.

<!-- ─────────────────────────────────────────────────────────────────────── -->
<!-- Project-specific gotchas. Edit this section per project; everything    -->
<!-- below the "Stack canon" divider is wholly canon and synced.            -->
<!-- ─────────────────────────────────────────────────────────────────────── -->

## Project

_(none yet)_

<!-- ─────────────────────────────────────────────────────────────────────── -->
<!-- Stack canon — synced wholesale on each canon update. Don't edit below  -->
<!-- this line in a downstream project; flag drift and fix in the canon.   -->
<!-- ─────────────────────────────────────────────────────────────────────── -->

# Stack canon

## Backend (Go)

### Error handling

- **Don't swallow errors.** No `try/catch` wrapping, `_ = ...` discards, or `recover()` from panics — let them propagate. A hidden error is one the gate can't catch.
- **Boundary validation only.** The stack already covers the boundaries: Zod on the SPA, `validate:"..."` + `DecodeJSON[T]` on the server, `sql.ErrNoRows` → 404. Don't add redundant validation inside domain logic.

### chi

- **Handler tests must route through a `chi.Mux`.** `chi.URLParam` returns
  `""` outside a chi-routed request, so direct `handler.ServeHTTP(w, r)`
  calls silently break path params and produce confusing 500s or empty IDs.
  Use a `setup<Module>Router(t)` helper to build a real mux and let it
  dispatch — see `internal/api/notes_test.go`.

### sqlc

- **ASCII only in `db/queries/*.sql`.** sqlc's SQLite grammar parser has a
  UTF-8 byte/rune offset bug. Any non-ASCII character anywhere in a query
  file — comments, string literals, identifiers — silently corrupts query
  boundaries: subsequent queries get truncated by the byte-vs-rune count
  of the offending character. `sqlc generate` succeeds and emits
  valid-looking Go, but the embedded SQL strings are mangled (e.g.
  `ORDER BY full_na` instead of `ORDER BY full_name`). The build passes;
  queries fail at runtime with "no such column", "syntax error near 'X'",
  or unexpected `?1` / `?2` parse errors.

  Rules:
  - Comments use plain `-` / `--`, never `—` (em-dash), `–` (en-dash),
    smart quotes, or any non-ASCII glyph.
  - Identifiers (table/column/alias names) are ASCII only.
  - For non-ASCII string literals, use SQLite's `char(N)` codepoint
    syntax instead of writing the literal character:

    | Glyph | `char()` |
    |-------|----------|
    | `á`   | `char(225)` |
    | `é`   | `char(233)` |
    | `í`   | `char(237)` |
    | `ó`   | `char(243)` |
    | `ú`   | `char(250)` |
    | `ñ`   | `char(241)` |
    | `Ñ`   | `char(209)` |

  Atlas's parser handles non-ASCII fine in `schema.sql` — this is sqlc-specific.

  Worked example (accent-folded LIKE search):

  ```sql
  -- name: ListUsersFiltered :many
  SELECT id, email, full_name, role
  FROM users
  WHERE
      (sqlc.narg('q') IS NULL OR
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(full_name),
              char(225),'a'),char(233),'e'),char(237),'i'),
              char(243),'o'),char(250),'u'),char(241),'n')
          LIKE '%' || sqlc.narg('q') || '%')
  ORDER BY full_name;
  ```

  The Go handler folds the search query (lowercases + strips combining
  marks via `golang.org/x/text/unicode/norm` NFD) before binding.

- **`engine: sqlite`, not `sqlite3`** in `sqlc.yaml`.
- **`ORDER BY ?` doesn't parameterise.** Whitelist sort columns in Go
  and string-format into the SQL.
- **`IN (?)` with a slice doesn't work.** Use `sqlc.slice('ids')` or
  expand to `?,?,?` in Go.
- **`LIKE ?` is exact match without wildcards.** Build `"%"+s+"%"` in Go.
- **`COUNT(*)` returns `int64`, not `int`.**
- **Aggregates over nullable columns return `interface{}`.** sqlc can't
  prove non-null. Wrap with `CAST(COALESCE(SUM(x), 0) AS REAL)` (or
  `AS INTEGER`) to force a concrete type. Same trap with nullable
  `CASE WHEN ... ELSE NULL END`.
- **JOINs need column aliases** — without them sqlc generates `Id_2`-style
  names or errors on conflict. `SELECT a.id AS account_id, b.id AS book_id`.
- **`sqlc.arg(name)`** is required when the same value appears more than
  once in a query.
- **Generated names are not predictable** — read `internal/db/sqlc/*.sql.go`
  before wiring call sites.

### sqlite

- **Autoindex trap.** If a DB was ever populated by raw `db.Exec(schemaSQL)`,
  SQLite stored inline `UNIQUE` constraints as
  `sqlite_autoindex_<table>_<n>` — Atlas can't reconcile these. Drop and
  recreate the table, or replace with named `UNIQUE INDEX` and update
  `schema.sql`. Prevention: never let the app touch DDL.

- **`ALTER ADD COLUMN NOT NULL DEFAULT … REFERENCES` fails on non-empty
  tables.** SQLite can't validate the FK on the default. Add the column
  nullable, backfill, then tighten in `schema.sql` (Atlas recreates the
  table for you).

- **No `DATE` type.** Use `TEXT` (`YYYY-MM-DD`) or `DATETIME` (sqlc maps
  the latter to `time.Time`). Picking `DATE` produces surprising affinity
  behaviour at query time.

- **In-memory test DBs need DSN-encoded pragmas.** `PRAGMA foo = bar` via
  `db.Exec` is per-connection — useless once the pool opens a second one.
  Encode in the DSN: `file:test_<t.Name()>?mode=memory&_pragma=foreign_keys(1)`.
  Handler tests also need `cache=shared` because handlers may begin a
  transaction and call helpers via `*sql.DB`. Domain tests can drop
  `cache=shared` and instead `db.SetMaxOpenConns(1)`.

### atlas

- **Read before writing any migration SQL.** Before writing a new migration (including seed), read an existing migration of the same type and check `schema.sql` for exact column names and nullability. Writing from memory produces wrong column names and missing fields that are only caught at `make db-reset` time.

- **Parallel subagent waves produce migration number collisions.** Each wave independently picks the next available number from the sequence. Before merging any wave, run `ls db/migrations-demo/*.sql | sort` and rename colliding files (`0022_wave3.sql` → `0023_wave3.sql`) before merging. The gate won't catch this — Atlas applies migrations in filename order and silently skips or mis-sequences them.

- **Pair `atlas schema apply` with `sqlc generate`.** The build passes if
  you only do one. The app crashes at runtime when the live DB is ahead
  of generated Go (or vice versa). `make iterate` and `make generate`
  do both — use them rather than running them by hand.

- **No DDL from the application.** Atlas owns the schema. No
  `db.Exec(schemaSQL)` at startup, no `CREATE TABLE IF NOT EXISTS`, no
  runtime migrations. Seed data only. Schema changes go through
  `schema.sql` + `atlas schema apply`. Inline `UNIQUE` constraints written
  by `db.Exec` poison the DB (see SQLite autoindex trap).

- **Seed data is SQL, never Go.** Demo / dev fixtures live in
  `db/migrations-demo/*.sql` and run via `make seed-demo` /
  `make db-reset`. Don't write Go seed helpers (`testpersonnel.go`,
  `seedDemo()`, `db.Exec` strings in `main.go`) — they drift from
  `schema.sql` and bypass the `make db-reset` flow. Test fixtures use a
  schema-only in-memory DB plus domain calls to create rows
  (`internal/api/notes_test.go` is the canonical example); tests that
  genuinely need the demo dataset `os.ReadFile` the migration files
  rather than re-implementing them in Go.

### tygo

- **`time.Time` MUST have an explicit `type_mapping`.** Without it, tygo
  emits a default that doesn't match what `encoding/json` actually
  serialises. Stack convention in `tygo.yaml`:

  ```yaml
  type_mappings:
    time.Time: "string /* ISO-8601 */"
  ```

- **JSON tags drive wire field names.** Without a `json:"..."` tag, tygo
  uses the Go field name, which won't match what `encoding/json` emits.
  Always add explicit json tags on wire types.

- **`omitempty` becomes optional (`?:`) in TS.** That's the wire reality —
  the field may be absent. Match it consistently in your Zod schemas, or
  the SPA will type-error on `undefined` values from the server.

- **The output is checked in.** `make gen-check` fails if
  `web/src/types/api.ts` differs from a freshly run `tygo generate`.
  Don't hand-edit; don't commit stale output.

- **Keep wire types flat and concrete.** No `interface{}`, no `any`, no
  embedded types tygo can't follow. Anything fancy belongs in domain
  types, not wire types.

### dotenv (godotenv)

- **`cmd/server/main.go` loads `.env.local` then `.env` at startup.**
  `_ = godotenv.Load(".env.local", ".env")` — first wins for any key,
  and existing process env vars override both, so prod (which sets vars
  directly) is unaffected. Both files are optional; missing is a no-op.

- **`.env.local` is gitignored** (per the canon `.gitignore`); `.env` is
  the committed file holding non-secret defaults shared across machines.
  Never put secrets in `.env`. Real keys go in `.env.local` only.

- **Read via `getEnv(key, default)`, not bare `os.Getenv`.** Empty string
  is treated as unset so a stray `PORT=` line in `.env` can't blank out
  a default. Stack-shaped vars: `DB_PATH`, `PORT`, `SPA_DIR`.

- **Don't `godotenv.Load()` from tests or libraries.** Only `cmd/server`
  loads the file. Tests should set env vars they care about explicitly
  via `t.Setenv` so they're hermetic.

## Frontend (React SPA)

### Vite

- **The `/api` proxy in `server.proxy`** is what makes `vite dev` work
  against the Go server. Without it, dev-mode `fetch('/api/notes')`
  404s on the Vite server. See `web/vite.config.ts`.

- **Path alias must match in three places.** `vite.config.ts`
  (`resolve.alias`), `tsconfig.json` (`paths`), and `tsconfig.app.json`
  (`paths`). Drift means imports work at build but typecheck fails — or
  vice versa.

- **TypeScript 6+ no longer requires `baseUrl`.** `paths` resolves relative
  to the tsconfig file. If you see `error TS5101: Option 'baseUrl' is
  deprecated`, remove `baseUrl` and keep `paths`.

- **`vite build` runs `tsc -b` first** (per `web/package.json`). TS errors
  fail the build — this is what catches drift between tygo output and
  SPA usage.

- **`web/dist` is gitignored** — built and served by `cmd/server` at
  runtime, never committed.

### Tailwind v4

- **Responsive by default.** Mobile widths in the same pass — `sm:` / `md:` / `lg:` is the lever. Don't build desktop-first and retrofit.

- **No `tailwind.config.js` by default.** Configuration lives in CSS via
  `@theme {}`. Agents trained on v3 reach for the JS file and break.

- **Single `@import "tailwindcss"`** replaces `@tailwind base/components/utilities`
  from v3. There is no separate base/components/utilities import.

- **The Vite plugin is required.** `@tailwindcss/vite`. Without it, Tailwind
  silently emits no CSS at all.

- **shadcn (Nova preset) injects `tw-animate-css` and `shadcn/tailwind.css`**
  imports above `@theme`. Don't reorder them.

- **`@theme` vs `@theme inline`.** `inline` emits the variables verbatim
  into `:root`; plain `@theme` lets v4 resolve them. shadcn uses `inline`
  for its mapped tokens.

- **Dark mode is `:root` + `.dark` CSS variables**, paired with
  `@custom-variant dark (&:is(.dark *))`. shadcn sets this up in
  `web/src/index.css`.

### shadcn/ui

- **Reuse before inventing.** Grep `web/src/` for an existing shadcn primitive or Tailwind utility before building a new pattern from scratch.

- **The `form` component is NOT in the Nova preset registry.**
  `npx shadcn@latest add form` fails silently. Wire React Hook Form
  directly with raw `<form>` + shadcn `<Input>`/`<Label>` instead.
  See `web/src/pages/notes.tsx` for the canonical shape.

- **CLI flags.** `-t vite` for the Vite scaffold, `-b radix` for Radix
  primitives, `-p nova` (or vega/maia/lyra/mira/luma/sera) for presets.
  `--base-color` is from old shadcn — gone in v4.

- **`src/components/ui/*` re-exports both the component and its
  `xxxVariants` helper.** That trips `react-refresh/only-export-components`
  on every primitive. Stack solution: `globalIgnores(['src/components/ui/**'])`
  in `eslint.config.js`.

- **`components.json` aliases must match `tsconfig.json`'s `paths`.** The
  `@/` alias has to be wired in `vite.config.ts` AND tsconfig.

- **Don't hand-edit `src/components/ui/*`.** They're generated by the CLI;
  re-running `add` overwrites them. Custom variants belong in a wrapper
  component or in the calling code.

### React (19+)

- **Sonner for one-shot feedback** — saves, deletes, non-blocking errors. Wired at the app root; don't reach for a custom toast or `alert()`.

- **`form.handleSubmit` returns a Promise.** Passing it directly to
  `<form onSubmit={...}>` trips `@typescript-eslint/no-misused-promises`
  (the DOM expects a void return). Stack pattern:

  ```tsx
  const submit = form.handleSubmit((values) => create.mutate(values))
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => { void submit(e) }
  ```

- **Floating promises in handlers / effects** are caught by
  `@typescript-eslint/no-floating-promises`. Use the `void` operator for
  fire-and-forget (e.g. `void queryClient.invalidateQueries(...)`); use
  `await` if you genuinely depend on completion.

- **StrictMode double-invokes effects in dev.** Don't side-effect on mount
  without a cleanup; don't rely on "exactly once" behaviour outside
  production.

- **Server state lives in TanStack Query, not `useState`.** `useState` is
  for ephemeral UI state (open/closed, hover, focus). Anything fetched
  from `/api` goes through queries / mutations.

- **Refs in React 19** — `forwardRef` is unnecessary; `ref` is now a
  regular prop. Old `forwardRef` code still works but new components
  shouldn't reach for it.

- **`React.FC` is discouraged** — implicit children, generic noise. Use
  plain function declarations.

### React Router v7

- **v7 has TWO modes: declarative (this stack) and framework (Remix-style).**
  Most v7 docs default to framework mode. Stack choice: declarative SPA,
  `BrowserRouter` at the root of `web/src/main.tsx`. Don't reach for
  framework-mode APIs (`createBrowserRouter` with file conventions, route
  modules, etc.).

- **The Go server's SPA fallback is what makes deep links work.**
  `cmd/server/main.go` serves `web/dist/index.html` for any non-`/api`
  path that doesn't exist on disk. Without this, refreshing on
  `/notes/123` 404s.

- **`/api` is excluded from SPA fallback.** chi mounts `/api/*` first, so
  JSON routes never reach the SPA handler.

- **Use `fetch` (or the project's API client) for `/api`, not `<Link>`.**
  `<Link>` is for in-SPA navigation; `/api` endpoints aren't React
  Router routes.

- **`useParams<{ id: string }>()` doesn't enforce.** It's just a generic.
  Validate at the use site.

### TanStack Query

- **`invalidateQueries` returns a Promise.** `@typescript-eslint/no-floating-promises`
  flags it. Use `void queryClient.invalidateQueries(...)` for fire-and-forget,
  `await` if you need to wait.

- **Prefer `mutate` over `mutateAsync`.** `mutate` returns void; `mutateAsync`
  returns a Promise that ALSO trips no-floating-promises if you don't
  await it. Stack convention: `mutate` + `onSuccess`/`onError` callbacks.

- **Server 422 → `setError`.** The project's `ApiError.fieldErrors` carries
  field-keyed validation messages from the Go server. In `onError`,
  iterate and call `form.setError(field, { message })`. The `_form` key
  is for non-field errors — show as `toast.error`.

- **`queryKey` is a structured cache key, not a URL.** Project convention:
  top-level resource then optional id, e.g. `['notes']`, `['notes', id]`.

- **`QueryClient` lives at the app root.** Created once in `main.tsx`,
  wrapped around the router. Don't create per-component.

- **No SSR / no prefetching.** This is a CSR SPA — the dehydrate/hydrate
  story doesn't apply.

### React Hook Form

- **`handleSubmit` Promise wrap.** See React above — same pattern.

- **`defaultValues` are required for typed forms.** Without them,
  `form.register` widens types and `setError`'s `field` parameter loses
  its narrow string-literal type.

- **Server 422 → `setError`.** See TanStack Query section for the full pattern; add `as keyof Values` for strict typing on the field argument.

- **`aria-invalid={!!errors.field}`** is the stack convention for
  accessibility — pair with the shadcn `Input` (which forwards
  `aria-invalid`).

- **The shadcn `form` helper is NOT used in this preset.** Use raw
  `<form>` + shadcn `<Input>` + `<Label>` + a small error `<p>` instead.
  See `web/src/pages/notes.tsx`.

- **`reset()` after success.** Call inside `onSuccess` of the mutation to
  clear the form.

### Zod v4

- **`.optional().transform()` breaks `zodResolver` typing.** When a
  transform is present, the schema's input type ≠ output type, and
  RHF's `Resolver<TFieldValues, TContext, TTransformedValues>` complains
  the resolver's input doesn't match form values. **Fix**: keep schemas
  pure (no `.transform`) when used with RHF; do post-validation
  normalisation (e.g. empty-string → undefined) in the submit handler
  instead.

- **Server is the final arbiter.** Zod schemas mirror the Go
  `validate:"..."` tags but the server validates again. 422 responses
  come back keyed by JSON field name; merge them into RHF via
  `setError`.

- **`.optional()` returns `T | undefined`; `.nullish()` returns
  `T | null | undefined`.** Pick deliberately — JSON omits undefined
  fields; null is sent on the wire.

## Tooling

### Makefile / `make check`

- **`make check` is the gate.** It treats any uncommitted change as
  failure — if you have intentional WIP, commit or stash before running.
  Order is fail-fast: lint → gen-check → tidy-check → build → test →
  web-typecheck → web-lint → web-build → schema-diff.

- **`make iterate`** runs `tygo generate && go build` after every Go edit
  so the SPA's TS types never see a stale contract after a struct edit in
  `internal/api`.

- **`make run` depends on `web-build`.** First-time / fresh-clone path
  works without manual setup — but every restart pays ~200ms for vite
  build.

- **`make web-*` targets all depend on `web-install`.** `npm install` is
  idempotent and ~1s when nothing's changed, so always running it is
  cheaper than debugging "tsc: not found" on a fresh clone.

- **Go patterns are scoped to `./cmd/... ./internal/...`** rather than
  `./...` because `web/node_modules` contains stray Go files that the
  toolchain would otherwise descend into.

### ESLint (typescript-eslint, type-checked)

- **Type-aware rules are on (`recommendedTypeChecked`).** Costs ~1s of
  ESLint startup; pays for itself with `no-floating-promises` and
  `no-misused-promises`.

- **`src/components/ui/**` and `src/types/**` are ignored.** Shadcn
  primitives re-export `xxxVariants` helpers (trips `react-refresh`);
  tygo output is generated.

- **Config files (`*.{js,mjs,cjs}`) disable type-aware rules** — they're
  not part of the TS project, so type-aware linting would fail to resolve
  them.

- **If you find yourself disabling `no-floating-promises` or
  `no-misused-promises` per-line, think twice.** They catch the most
  common silent bugs in a TanStack Query + RHF codebase.
