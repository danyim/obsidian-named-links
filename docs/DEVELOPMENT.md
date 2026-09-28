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
| `scraper.ts` | Finds a title for a URL: oEmbed, a HEAD request to spot files, then the page's HTML. No Obsidian imports, so it is unit tested under Node. |
| `http.ts` | The scraper's HTTP client: Obsidian's `requestUrl` with a timeout. |
| `url.ts` | Recognizes URLs and finds links and bare URLs on a line. |
| `title.ts` | Cleans, shortens and escapes a title for use as link text. |
| `context.ts` | Tells whether a position is in code, frontmatter or a link target. |
| `settings.ts` | The settings shape and defaults, excluded-site matching, and the Auto Link Title import. |
| `settingsTab.ts` | The settings tab, through `getSettingDefinitions()`. |
| `lang/` | UI strings: `en.ts` defines them, `ja.ts` translates them, `index.ts` picks one by Obsidian's language. |

`url.ts`, `title.ts`, `context.ts`, `scraper.ts` and `settings.ts` don't import
`obsidian`, which is what lets the unit tests run them directly. Keep them that
way; anything that needs the Obsidian API goes in the other modules.

To try a build in a real vault, copy or symlink `main.js`, `manifest.json` and
`styles.css` into `<vault>/.obsidian/plugins/named-links/` and enable the
plugin. Obsidian doesn't pick up a rebuilt `main.js` on its own: use the
[Hot Reload](https://github.com/pjeby/hot-reload) plugin, or toggle the plugin
off and on.

See [TESTING.md](TESTING.md) for running the test suite.
