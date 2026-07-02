# Deployment (Deno Deploy)

Live at **https://calstakk.jpincas.deno.net**. Org slug: `jpincas` (display
name "jonathanpincas" — the two differ, don't assume they match). App name:
`calstakk`. Both are saved in `deno.json`'s `"deploy"` block, so a redeploy is
one command from the repo root:

```bash
~/.deno/bin/deno deploy --org=jpincas --app=calstakk --prod
```

This is the **`deno deploy` CLI** (bundled with modern Deno, `deno deploy
--help`), not the older standalone `deployctl` — they target different
generations of the platform and are not interchangeable. `DENO_DEPLOY_TOKEN`
must be set in **`~/.zshenv`** (not `~/.zshrc` — that's only read by
interactive shells, so agent/CI shells never see it) for non-interactive
auth — the browser-based interactive login fails on this machine (no working
Secret-Service/keychain daemon), and `deployctl`'s classic org/project model
does not match this account's org at all (using it here previously created a
stray duplicate "classic" org — harmless but worth knowing if one shows up in
the dashboard).

**Build config** (set once in the Deno Deploy dashboard, "Edit Config"):
- Entrypoint: `server.ts`, Runtime mode: Dynamic, App Directory: repo root.
- Install command: `deno task web-install` (installs `web/`'s npm deps with
  `--ignore-scripts` — required because `msw` (transitive via `vitest`) has a
  `postinstall` script that runs `node -e ...`, and this platform's `node` is
  actually a Deno shim that mis-parses the args msw passes, hard-failing the
  install otherwise).
- Build command: `deno task web-build`.
- Both commands must go through **`deno task`**, not raw shell (`cd web &&
  ...` typed directly into the dashboard field silently mangles `&&` into a
  single `&`, which backgrounds the `cd` instead of chaining it — `deno task`
  uses Deno's own bundled shell and doesn't have this problem).
- A Deno KV database must be provisioned and assigned to the app (`deno
  deploy database provision <name> --kind=denokv --org=jpincas` then
  `database assign <name> --org=jpincas --app=calstakk`) — unlike classic
  Deploy, KV is not automatic.
- Env vars (`CALSTAKK_USERNAME`, `CALSTAKK_PASSWORD`, `CALSTAKK_DISPLAY_NAME`,
  `CALSTAKK_TIMEZONE`) are set via `deno deploy env add <KEY> <VALUE>
  --org=jpincas --app=calstakk`, not `.env`/`.env.local` (those files aren't
  read on Deploy).

**Dashboard "Retry" reuses the previously uploaded source** — it does not
re-upload local changes. After editing anything (including `deno.json`), use
`deno deploy --prod` again rather than clicking Retry in the dashboard.
