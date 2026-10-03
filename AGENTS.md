# Named Links: agent instructions

Adapted from the [Obsidian sample plugin's `AGENTS.md`](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/AGENTS.md)
for this project's actual conventions. For anything not covered here, see
[`CONTRIBUTING.md`](CONTRIBUTING.md) (human-facing, more detail),
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) and
[`docs/TESTING.md`](docs/TESTING.md).

## Project overview

- Obsidian community plugin (TypeScript bundled to JavaScript), a maintained
  fork of [Auto Link Title](https://github.com/zolrath/obsidian-auto-link-title).
  It fetches the title of a pasted or dropped URL and inserts a markdown link.
- Entry point: `src/main.ts`, bundled to `main.js` by esbuild.
- Release artifacts: `main.js`, `manifest.json`, `styles.css`, plus a
  `named-links-<version>.zip` of the three for manual installs.
- Makes network requests, by design: to the URL being titled, and to oEmbed
  endpoints for a few video and music sites. Settings are the only persisted
  state, stored via `loadData()`/`saveData()`.

## Environment & tooling

- Node: 24.x (what CI runs; see `.github/workflows/test.yaml`).
- Package manager: npm.
- Bundler: esbuild, configured in `config/esbuild.config.mjs`.
- `@codemirror/*` packages are devDependencies for their types only:
  esbuild leaves them external, so the plugin runs against Obsidian's own
  copies. Keep them pinned to what Obsidian ships (`@codemirror/state` and
  `@codemirror/view` at the `obsidian` package's peer versions,
  `@codemirror/commands` at the version found in Obsidian's `app.js`). The
  `overrides` entry in `package.json` makes `@codemirror/commands` resolve
  against that same `@codemirror/state`, since two copies of its types
  don't type-check against each other.

```bash
npm install
npm run dev            # esbuild watch mode
npm run build          # tsc --noEmit + production esbuild
npm run check-types    # tsc --noEmit only
```

## Linting & formatting

- ESLint (`eslint.config.mts`) includes `eslint-plugin-obsidianmd`, which
  checks (among other things) that APIs used exist at the declared
  `minAppVersion`, that UI text is sentence case, that commands have no
  default hotkeys, and that `editor-paste`/`editor-drop` handlers check
  `defaultPrevented` and call `preventDefault()`.
- Prettier formats `src/` and `test/` with import sorting; config lives inline
  in `package.json`.

```bash
npm run lint
npm run lint:fix
npm run prettier
npm run clean         # prettier + lint:fix together
```

CI runs lint, type-check, and both test layers on every push and PR.

## File & folder conventions

See the table in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). The rule that
matters most: `url.ts`, `title.ts`, `context.ts`, `scraper.ts` and
`settings.ts` must not import `obsidian`, because the unit tests run them under
plain Node. The scraper takes its HTTP client as an argument for the same
reason.

Other top-level directories:

- `config/`: build and test tool configs.
- `scripts/`: `version-bump.mjs` (release tooling) and `xvfb-wm.sh` (virtual
  display for the e2e suite on Linux).
- `test/`: unit tests (`test/unit/`), e2e specs (`test/specs/`), the fixture
  HTTP server (`test/server.ts`), shared helpers, and the vault the specs open.
- `docs/`: project docs beyond the README.

`styles.css` and `manifest.json` are committed source files. `main.js` is a
build artifact and is gitignored; never commit it.

## Manifest rules (`manifest.json`)

- `id` is `named-links`. Never change it; it's the plugin's stable identity in
  the community catalog. It can't contain "obsidian".
- `minAppVersion` must stay accurate for the APIs the code uses.
  `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule enforces this.
  Raising it when a newer API is genuinely needed is expected; update the
  floor version in `config/wdio.conf.mts` with it.
- See the canonical requirements:
  https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

```bash
npm test                                    # unit + e2e, default version matrix
npm run test:unit                           # unit tests only, no display needed
OBSIDIAN_VERSIONS="latest/latest" npm test  # faster while iterating
```

New behavior should come with a test; a bug fix should come with one that
fails without the fix. E2E specs must use pages on the fixture server
(`test/server.ts`), never a real site. Read the "Things that trip up new
specs" section of [`docs/TESTING.md`](docs/TESTING.md) before writing one.

## Commands & settings

- Commands are added in `main.ts`'s `onload()`, with stable, never-renamed ids
  (`paste-url-with-title`, `paste-without-title`, `enhance-url-with-title`) and
  no default hotkeys.
- Settings render through `getSettingDefinitions()` in `settingsTab.ts`
  (`minAppVersion` is 1.13.0+, so there is no `display()` fallback).
- UI strings live in `src/lang/`. Add every new one to both `en.ts` and
  `ja.ts`.

## Undo history

A titled paste undoes in two steps: first back to the URL as pasted, then
to before the paste. The placeholder never appears in the history.
`src/history.ts` gets there by making the paste an isolated history event
and, when a title arrives with the note unchanged since, undoing the
plugin's own events and dispatching them again (URLs, then titles). Any
change that puts placeholders or titles into the editor has to go through
`insertTracked`, `changeTracked` and `finishPlaceholder`, not
`editor.replaceRange`. Undo specs in `test/specs/undo.e2e.ts` need titles
that take over half a second to arrive: CodeMirror merges an adjacent
change made sooner into the same step on its own, which would hide the
plugin's handling.

## Versioning & releases

For maintainers, not something an agent should do unprompted:

```bash
npm version <x.y.z>   # bump package.json, sync manifest.json + versions.json,
                      # commit, tag, push branch and tag
```

Pushing the tag triggers `.github/workflows/release.yml`, which builds the
plugin, zips the release files into a `named-links/` folder, attests
provenance for `main.js`, `styles.css` and the zip, and creates a **draft**
GitHub release that a maintainer reviews and publishes by hand.

## Security, privacy, and compliance

Follow Obsidian's [Developer Policies](https://docs.obsidian.md/Developer+policies)
and [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
Specific to this plugin:

- Never run a fetched page's code. Titles come from parsing HTML as data. Do
  not reintroduce Electron `BrowserWindow`s, `webview`s or iframes to load
  pages; that was the upstream plugin's most serious problem.
- Network requests go only to the URL being titled and to the oEmbed
  endpoints in `scraper.ts`. Any other destination (like the FxTwitter option)
  must be opt-in, off by default, and disclosed in the README's Privacy
  section and in the setting's description.
- Every request goes through `http.ts`, which enforces a timeout.
- No telemetry or analytics.

## Coding conventions

- TypeScript with `noImplicitAny` and `strictNullChecks` on.
- Comments explain *why*, not *what*. When a line fixes an upstream bug, cite
  the upstream issue number.
- Keep `main.ts` to plugin lifecycle and wiring; put logic in the other
  modules.
- `isDesktopOnly` is `false`: no Node or Electron APIs in `src/`.

## Agent do/don't

**Do**

- Keep command ids and the plugin `id` stable.
- Run `npm run lint`, `npm run check-types` and `npm run test:unit` before
  considering a change done; run the e2e suite for anything touching what gets
  inserted into the editor or the settings tab.

**Don't**

- Load fetched pages in anything that executes them.
- Send URLs to a third party without an opt-in setting.
- Commit `main.js` or other build output.
- Bump the plugin version unless asked.

## Troubleshooting

- **Plugin doesn't load after a manual install**: `main.js`, `manifest.json`
  and `styles.css` must sit at the top level of
  `<vault>/.obsidian/plugins/named-links/`.
- **e2e tests hang or fail to download Obsidian**: the first run downloads
  real Obsidian builds and needs a display on Linux (`scripts/xvfb-wm.sh`
  handles it; install `xvfb` and `herbstluftwm`).
