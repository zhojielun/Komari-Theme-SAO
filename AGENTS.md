# AGENTS.md

Komari theme, not a standalone site: a React 19 SPA that is built and shipped as a Komari theme ZIP. Monitor data comes from a Komari backend on the same origin under `/api`; there is no Vite proxy, so use the built-in mock when developing without a backend.

## Commands

Use Node 22 as CI does. Vite 8 requires `^20.19.0 || >=22.12.0`, even though the README badge still says Node 18.

```bash
npm ci
npm run dev                 # open http://localhost:5173/?mock=1
npm run lint                # eslint (scripts/public ignored)
npm run typecheck           # tsc -b
npm test                    # vitest run, Node environment
npx vitest run src/utils/__tests__/format.test.ts   # focused test
npm run build               # tsc -b && vite build
npm run package             # build + preview.png + Komari-Theme-SAO-v<version>.zip
```

CI runs `lint -> test -> package` on every `v*` tag and publishes the ZIP plus `preview.png` to GitHub Releases. `npm run release` checks version alignment, typechecks, builds, and packages, but does **not** run lint or tests.

## Dev mock

`src/main.tsx` installs `src/dev/mockApi.ts` only in dev when `?mock=1` (or session storage from an earlier `?mock=1`). It intercepts same-origin `/api/*` and fakes a logged-in admin, so theme management works without a backend.

- `?mock=0` clears the mock session; `?admin=0` makes the mock a guest.
- `?nodes=40` sets the mocked node count; `?multiPing=1` enables the three-way ping layout.
- `?cluster=nodes` / `?cluster=classic` / `?matrix=1` override the overview mode.
- `?view=theme-manage` opens theme settings; `?mock_error=1` exercises the access-error screen.
- Mock theme settings persist in `localStorage` under `komari_mock_theme_settings`.

The real app has no proxy: `fetch` calls are absolute `/api/...`, and `index.html` pre-fetches `/api/public`, `/api/me`, and `/api/nodes` into `window.__EARLY_DATA__` before React starts. Preserve that early-data handoff; `services/api.ts` consumes and nulls each promise.

## Architecture

- Entry: `src/main.tsx` -> `src/App.tsx` -> `src/router.tsx`. `AppShell` owns access/private-site gating and initial node-store hydration.
- `src/pages/` routes: `/`, `/instance/:uuid`, `/assets`, `/traffic`, `/404`. `Home` is deliberately eager; `Instance`, `Assets`, and `NotFound` are lazy. `src/styles/__tests__/homeLayout.test.ts` enforces this and several CSS/markup contracts.
- `src/services/api.ts` is the only API layer. It uses lenient Zod schemas with defaults/coercion and multi-version Komari fallbacks (RPC2 metrics, legacy records, HTTP). Don't bypass it or "tighten" schemas without compatibility tests.
- `src/services/rpc2Client.ts` speaks JSON-RPC 2.0 over WebSocket with HTTP fallback. Only use it for idempotent read-only methods: timeouts may replay a call over HTTP.
- Despite its name, `src/services/wsStore.ts` is a polling external store (2s live status, 30s node info), not a WebSocket push store. Hooks in `src/hooks/useNode.ts` expose it via `useSyncExternalStore`.
- Theme settings live in `src/utils/themeSettings.ts`. A new setting needs: `ThemeSettings` in `src/types/komari.ts`, `ResolvedThemeSettings`, `DEFAULT_THEME_SETTINGS`, and `normalizeThemeSettings`, then the `ThemeManage` UI. Settings are read from `/api/public` `theme_settings` and saved wholesale through `/api/admin/theme/settings?theme=<publicConfig.theme>`.

## Styling

- Tailwind 4 is configured entirely in CSS (`@import "tailwindcss"` in `src/styles/index.css`); do not add `tailwind.config.*`.
- Reuse tokens from `src/styles/tokens.css`. Theme tokens are declared on `:root` only; `html[data-appearance]` drives light/dark. Avoid redeclaring tokens on cards.
- Browser target is ES2022 / Chrome 111 / Safari 16.2 because the design relies on `color-mix()` and OKLCH. Don't lower it or replace these with precomputed colors casually.

## Testing and conventions

- Vitest runs in the Node environment; there is no jsdom or React Testing Library. Component tests use `renderToStaticMarkup`, and CSS contract tests read source files with `node:fs` and assert exact strings, media queries, and class names. Update those tests whenever the asserted markup/CSS contract changes.
- Tests live in `__tests__` next to the code they cover.
- Strict TS includes `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax`; use `import type`.
- UI copy, comments, and warning messages are Chinese; identifiers are English. Keep new text consistent.
- The version must match in `package.json` and `komari-theme.json`; the ZIP name comes from `komari-theme.json`, and the footer reads `package.json`. Add release notes at `.github/release-notes/v<version>.md` before tagging.
- `preview.png`, `dist/`, and `*.zip` are generated; edit `docs/images/theme-preview.png` instead of the root preview.
