# Contributing

Thanks for wanting to help. Named Links is a small plugin with a small surface
area, so most contributions are small too, and that's the intent.

## Reporting a bug or asking for a feature

Open an issue and the form will ask for what's needed. Two things worth knowing
up front:

- **Include the Obsidian version, the plugin version, and the URL.** Most title
  problems depend on the site, so the URL (or one like it) is the fastest way
  to a fix.
- **Check which plugin you're running.** Named Links is a fork of
  [Auto Link Title](https://github.com/zolrath/obsidian-auto-link-title). The
  two can be installed side by side, so make sure the bug is in this one.

If a change is large or would alter what gets inserted into notes, open an
issue before writing the code. It's a cheaper place to disagree than a pull
request.

## Getting set up

You need Node 24 (what CI runs) and npm.

```bash
git clone https://github.com/danyim/obsidian-named-links
cd obsidian-named-links
npm install
npm run dev     # rebuild main.js on change
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) describes how the code is laid out
and how to try a build in a real vault.

## Style

Formatting and linting are enforced, not advisory:

```bash
npm run lint          # eslint, including eslint-plugin-obsidianmd
npm run lint:fix
npm run prettier      # format src/ and test/
npm run clean         # prettier + lint:fix together
npm run check-types   # tsc --noEmit
```

Comments explain *why* something is the way it is (a constraint, a
workaround, an Obsidian quirk, the upstream issue a line fixes) rather than
restating what the line does. If a piece of code needs no explanation, it needs
no comment.

UI text lives in `src/lang/en.ts`. Adding a string means adding it to
`src/lang/ja.ts` too; TypeScript fails the build otherwise. If you don't speak
Japanese, put the English there and say so in the PR.

## Tests

```bash
npm test                                    # unit + e2e, 1.13.4 and latest, desktop and mobile UI
npm run test:unit                           # just the unit tests, under a second
OBSIDIAN_VERSIONS="latest/latest" npm test  # faster while iterating
```

The first e2e run downloads Obsidian, so give it a minute.
[docs/TESTING.md](docs/TESTING.md) covers how the suite works and the pitfalls
of writing new specs.

New behavior should come with a test; a bug fix should come with one that
fails without the fix. Logic that doesn't need Obsidian gets a unit test in
`test/unit/`; anything about what ends up in the editor gets an e2e spec in
`test/specs/`, using a page on the fixture server (`test/server.ts`) rather than
a real site.

## Pull requests

- Branch off `main`.
- Keep the change focused. Unrelated cleanups are welcome, but as their own PR.
- Make sure `npm run lint`, `npm run check-types` and `npm test` pass. CI runs
  all three, on any target branch.
- Don't commit a rebuilt `main.js`. It's a build artifact.
- Don't bump the version. Releases are cut separately (see below).
- Write the description for someone who wasn't in your head: what changed, and
  why. The PR template asks for exactly that.

## Releases

For maintainers. `npm version <x.y.z>` does the whole bump: it updates
`package.json`, runs the `version` script to sync `manifest.json` and
`versions.json`, commits, tags, and (via `postversion`) pushes the branch and
the tag. The pushed tag triggers the release workflow, which builds the
plugin, generates artifact attestations, and creates a **draft** GitHub release
with the three loose files the community catalog installs from (`main.js`,
`manifest.json`, `styles.css`) plus `named-links-<version>.zip`, which wraps
them in a `named-links/` folder for manual installs.

Check the draft over on GitHub (assets and generated notes), then publish it
from there. Nothing goes out to users until you do.

The first release is the exception: `manifest.json` already says 1.0.0, so
there is nothing for `npm version` to bump. Cut it by pushing the tag directly:

```bash
git tag 1.0.0 && git push origin 1.0.0
```

`minAppVersion` in `manifest.json` is the floor the tests are pinned against,
so raising it means updating `config/wdio.conf.mts` too.

## License

Named Links is MIT licensed, inherited from Auto Link Title. By contributing
you agree your contribution is licensed the same way.
