# Testing

```bash
npm test
```

runs both layers:

- **Unit tests** (`npm run test:unit`): mocha under Node, via `tsx`, over the
  modules in `src/` that don't import Obsidian (URL recognition, title escaping,
  code/frontmatter detection, excluded-site matching, and the scraper against a
  fake HTTP client). They take well under a second and need no display, so run
  them on their own while working on that logic. linkedom stands in for the
  browser's `DOMParser` (`test/unit/setup.ts`).
- **End-to-end tests** (`npm run test:e2e`): real Obsidian, driven by
  [wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service),
  which downloads and sandboxes its own copies of the app.

Both `npm test` and `npm run test:e2e` build `main.js` first. Obsidian loads
whatever build is in the checkout, and a stale one silently tests the wrong
code.

## Nothing goes to the internet

Each e2e worker starts a small HTTP server on `127.0.0.1` (`test/server.ts`)
with a page for every case the scraper has to handle: a plain title, markdown
in a title, a GBK-encoded page, Open Graph only, no title, a 404, a bot
challenge, a redirect, a PDF behind an extensionless path, and a page that
answers slowly or never. The specs paste those URLs, so the suite doesn't
depend on the network or on what a real site looks like today. The server also
logs every request, which is how the specs check that excluded sites, images
and plain-text pastes are never fetched, and that a file gets a HEAD request
but no download.

Pastes and drops are dispatched as real `paste` and `drop` events on
CodeMirror's content element, the path Obsidian takes to raise `editor-paste`
and `editor-drop`, rather than by calling the plugin's methods.

## Versions

By default the e2e suite runs against Obsidian 1.13.4 and `latest`, each on
the desktop and emulated-mobile UI. Override with:

```bash
OBSIDIAN_VERSIONS="latest/latest" npm test
```

`latest` catches regressions against current Obsidian; the floor build confirms
the plugin still works on the oldest version it declares support for. The floor
is 1.13.4 rather than wdio's `earliest`, which resolves to the `minAppVersion`
of 1.13.0: Obsidian 1.13.0 through 1.13.3 were insiders-only releases with no
public installer, so downloading them needs Catalyst credentials.

Each run writes renderings of the settings tab per Obsidian version and
platform into `test/screenshots/`. CI uploads them as build artifacts.

Auto Link Title 1.5.5 is installed, disabled, alongside the plugin. The
coexistence spec turns it on to check that a paste is handled once with both
enabled, and that the import reads the `data.json` it really writes.

A scheduled workflow re-runs the suite whenever a new Obsidian version ships.
To include Obsidian beta builds, add `OBSIDIAN_EMAIL` and `OBSIDIAN_PASSWORD`
repository secrets for an Insiders account with 2FA disabled.

## Display

On Linux, Obsidian needs a display. `npm test` handles this itself:
`scripts/xvfb-wm.sh` starts Xvfb with a window manager (matching CI's "Set up
virtual graphics" step) whenever `DISPLAY` isn't already set. It needs:

```bash
sudo apt-get install xvfb herbstluftwm
```

## Things that trip up new specs

- **Live Preview hides markup the cursor isn't in**, and won't keep a cursor
  set programmatically inside an empty `()` or an inline code span's
  backticks. It also shows frontmatter as a properties widget rather than
  text. Open such notes with `openNote(text, { source: true })`.
- **Every note gets a fresh name.** Obsidian restores a note's last cursor
  position shortly after opening it, which would undo the cursor a spec sets.
- **`defaultPrevented` says nothing.** CodeMirror calls `preventDefault` on
  every paste it handles itself, so check the resulting text and the request
  log, not the event.
- **Desktop settings open in their own window.** `captureRendering(name,
  { window: 'newest' })` screenshots that window instead of the main one.
- **Wait with `settled()`**, which resolves once every title lookup the plugin
  has started is written, rather than with fixed pauses.
