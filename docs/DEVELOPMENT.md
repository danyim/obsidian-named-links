# Development

```bash
npm install
npm run dev     # rebuild main.js on change
npm run build   # type-check and produce main.js
npm run lint
```

The plugin is TypeScript bundled by esbuild (`config/esbuild.config.mjs`) into
`main.js`. Everything it runs lives in `src/`:

| File | What it does |
| --- | --- |
| `main.ts` | Plugin entry point: loads settings, registers the paste and drop handlers and the commands, and watches for Mod+Shift+V. |
| `linker.ts` | Decides what a paste or drop inserts, puts placeholders in, and swaps each for its title (in the editor, or in the file if the editor has moved on). |
| `history.ts` | Keeps a titled paste to two undo steps, the URL as pasted and then the title, with no placeholder in between. The paste goes in as an isolated history event, and each arriving title rewrites the plugin's own events on top of the history when the note hasn't changed since. |
| `scraper.ts` | Finds a title for a URL: oEmbed, a HEAD request to spot files, then the page's HTML. No Obsidian imports, so it is unit tested under Node. |
| `http.ts` | The scraper's HTTP client: Obsidian's `requestUrl` with a timeout. |
| `url.ts` | Recognizes URLs and finds links and bare URLs on a line. |
| `title.ts` | Cleans, shortens and escapes a title for use as link text. |
| `cleanup.ts` | The optional clean-up between fetching a title and shortening it: removing the site name, and the user's title rules. |
| `context.ts` | Tells whether a position is in code, frontmatter or a link target. |
| `settings.ts` | The settings shape and defaults, excluded-site matching, and the Auto Link Title import. |
| `settingsTab.ts` | The settings tab, through `getSettingDefinitions()`. |
| `lang/` | UI strings: `en.ts` defines them, `ja.ts` translates them, `index.ts` picks one by Obsidian's language. |

`url.ts`, `title.ts`, `cleanup.ts`, `context.ts`, `scraper.ts` and `settings.ts` don't import
`obsidian`, which is what lets the unit tests run them directly. Keep them that
way; anything that needs the Obsidian API goes in the other modules.

To try a build in a real vault, copy or symlink `main.js`, `manifest.json` and
`styles.css` into `<vault>/.obsidian/plugins/named-links/` and enable the
plugin. Obsidian doesn't pick up a rebuilt `main.js` on its own: use the
[Hot Reload](https://github.com/pjeby/hot-reload) plugin, or toggle the plugin
off and on.

## README screenshots

`npm run screenshots` regenerates the images in `screenshots/` from a real
Obsidian render, so the README always shows what the current code produces.
It runs `config/wdio.screenshots.mts` against the latest Obsidian on desktop
and on the emulated phone UI, with the settings in `test/capture/readme.capture.ts`
filled in to show the title clean-up in use.

Each image is the whole settings tab, scrolled and stitched together one
window at a time, in light mode on the left and dark mode on the right. The
two halves meet at a seam whose gutter takes each half's own background
color. Like the tests, it needs a display (handled automatically on Linux),
and it renders in Inter, failing rather than falling back to another
typeface so the images match between machines:

```bash
sudo apt-get install fonts-inter
npm run screenshots
```

Regenerate them whenever the settings tab changes, and commit the PNGs.

See [TESTING.md](TESTING.md) for running the test suite.
