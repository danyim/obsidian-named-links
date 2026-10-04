# Named Links

Paste a URL into Obsidian and get a markdown link titled with the page's name: `https://example.com` becomes `[Example Domain](https://example.com)`.

![Pasting a URL and getting a titled link](docs/demo.gif)

> [!NOTE]
> Named Links is a maintained fork of [Auto Link Title](https://github.com/zolrath/obsidian-auto-link-title) by [@zolrath](https://github.com/zolrath), who deserves the credit for the original plugin. That project has been inactive since [December 2024](https://github.com/zolrath/obsidian-auto-link-title/releases/tag/1.5.5). This fork picks up from 1.5.5, fixes the bugs reported against it, and borrows the Japanese translation, FxTwitter lookups and `<URL>` pasting from [@yuu1111's fork](https://github.com/yuu1111/obsidian-auto-link-title).

## What it does

- **Paste a URL** and a `[Fetching title…](url)` placeholder goes in straight away, then becomes the titled link. Several URLs pasted at once are each titled.
- **Drop a URL** from another app and the same happens where you drop it.
- **Paste text over a selected URL** (or a whole link) to make the text its title, with nothing fetched. This one is off until you turn it on in settings.
- **Title URLs already in a note** with the [Add a title to an existing URL](#commands) command.
- **In vim mode**, putting a URL with `p` or `P` titles it the same way, counts, registers and visual mode included.
- **Undo** gives back the URL as you pasted it; undo again to remove the paste.

The URL is left as pasted when you paste as plain text (Ctrl/Cmd+Shift+V, a system shortcut, not one the plugin adds), paste with several cursors, paste into code, frontmatter or a link target (`[text](`, `[1]: `, `href="`), or paste an image or an excluded site's URL. If no title can be found, the URL stays and a notice says so.

Titles have their line breaks collapsed and markdown characters escaped. A file such as a PDF is named after its path rather than downloaded.

## Commands

None has a default hotkey; set one under Settings → Hotkeys.

| Command | What it does |
| --- | --- |
| Add a title to an existing URL | Titles the URL under the cursor, replacing a `[text](url)` link's text or turning a `<URL>` autolink into a link. With a selection, titles every bare URL in it, skipping code, frontmatter and URLs already in links. |
| Paste URL and fetch its title | Pastes and titles the clipboard's URLs, even with **Title pasted URLs** off. |
| Paste without fetching a title | Pastes the clipboard as it is. |

## Settings

![The Named Links settings tab in light and dark mode](screenshots/settings.png)

| Setting | Default | |
| --- | --- | --- |
| Link format | Markdown link | See [Link format](#link-format). |
| Decode URLs | Off | Write `%E5%AF%BF` as `寿`. See [Decoding URLs](#decoding-urls). |
| Title pasted URLs | On | Fetch titles for pasted URLs. |
| Title dropped URLs | On | Fetch titles for dropped URLs. |
| Use the selection as the title | On | Pasting a URL over selected text links that text instead of fetching. |
| Paste text onto a selected URL as its title | Off | Pasting text over a selected URL or link makes the text its title. Works with **Title pasted URLs** off too. |
| Remove the site name | Off | `Video - YouTube` becomes `Video`. See [Cleaning up titles](#cleaning-up-titles). |
| Domain title rules | Empty | Find and replace for one site's titles, run first. |
| Page title rules | Empty | Find and replace for every title, run second. |
| Maximum title length | 0 (no limit) | Shorten longer titles with `…`. |
| Fetch X posts through FxTwitter | Off | See [Privacy](#privacy). |
| Excluded sites | Empty | Never fetched. `example.com` covers its subdomains; other text matches any URL containing it. |
| Paste excluded sites as | The URL as it is | Or a link titled with the domain. |

### Link format

| Link format | Result |
| --- | --- |
| Markdown link | `[Example Domain](https://example.com)` |
| Markdown link with a hover title | `[Example Domain](https://example.com "Example Domain")` |
| HTML link | `<a href="https://example.com">Example Domain</a>` |
| Custom | Your own template using `{title}`, `{url}` and `{domain}` |

For example, `[source]({url})` writes `[source](https://example.com)` without fetching anything, and `<a href="{url}" target="_blank">{title}</a>` opens in a new tab. Each value is escaped for where it sits in the template, so a title can't break the link.

### Decoding URLs

With **Decode URLs** on, a finished link's URL is written with its percent-escapes decoded, so it's readable and searchable:

| Pasted | Written as |
| --- | --- |
| `https://jisho.org/word/%E5%AF%BF%E5%8F%B8` | `[Title](https://jisho.org/word/寿司)` |
| `https://en.wikipedia.org/wiki/Blue%20jay` | `[Title](<https://en.wikipedia.org/wiki/Blue jay>)` |

Anything that would change where the URL leads or break the markdown stays encoded (`%`, `/ ? # & =` and the other URL delimiters, quotes, brackets and invisible characters). The title is still fetched from the URL as pasted.

### Cleaning up titles

In order: tidy whitespace, remove the site name, run domain title rules, run page title rules, then shorten.

**Remove the site name** drops the first or last part of a title (split on ` | `, ` - `, ` · ` and similar) when it names the site, going by the page's `og:site_name` or its address. It handles abbreviations and a leading "The", and never empties a title.

| Before | After |
| --- | --- |
| `owner/repo: A description · GitHub` | `owner/repo: A description` |
| `An article \| The New York Times` | `An article` |
| `C - The Language` on another site | unchanged |

**Rules** are one `pattern => replacement` per line. Page title rules apply to every title:

```
(Official Video) =>
/^\[(\w+)\] (.*)$/ => $2 ($1)
```

Domain title rules start with the site they apply to, subdomains included:

```
github.com: /^GitHub - / =>
*.substack.com: / \| .*$/ =>
```

A pattern is literal text unless written `/pattern/flags`, which makes it a regular expression (add `g` to replace every match, and use `$1` for groups). An empty replacement deletes the match. Invalid lines are skipped and flagged in the settings tab, and rules never leave a title empty.

## Moving over from Auto Link Title

Named Links has its own plugin id, so settings don't carry over by themselves. If Auto Link Title's are still in your vault, the settings tab offers to import them. Disable Auto Link Title once you've switched; while both are on, whichever runs first takes each paste.

What's different from Auto Link Title 1.5.5:

- Titles are read from the page's HTML. Auto Link Title loaded pages in a hidden browser window with Node.js access, running every site's scripts on your machine ([#177](https://github.com/zolrath/obsidian-auto-link-title/issues/177), [#164](https://github.com/zolrath/obsidian-auto-link-title/issues/164)).
- No LinkPreview.net, and no default hotkeys ([#170](https://github.com/zolrath/obsidian-auto-link-title/issues/170), [#101](https://github.com/zolrath/obsidian-auto-link-title/issues/101)).
- Legacy encodings such as GBK decode correctly ([#133](https://github.com/zolrath/obsidian-auto-link-title/issues/133)), and YouTube, Vimeo, Spotify and SoundCloud titles come from oEmbed.
- `.ai` domains, hyphenated hosts, ports and IPs are recognized ([#172](https://github.com/zolrath/obsidian-auto-link-title/issues/172), [#154](https://github.com/zolrath/obsidian-auto-link-title/issues/154)), and `www.` URLs get `https://` ([#12](https://github.com/zolrath/obsidian-auto-link-title/issues/12)).
- Stuck requests time out instead of leaving `Fetching Title#…` behind ([#167](https://github.com/zolrath/obsidian-auto-link-title/issues/167)).
- URLs in code and frontmatter are left alone ([#36](https://github.com/zolrath/obsidian-auto-link-title/issues/36), [#21](https://github.com/zolrath/obsidian-auto-link-title/issues/21)), and excluded sites match by domain and can paste as plain URLs ([#159](https://github.com/zolrath/obsidian-auto-link-title/issues/159)).

## Privacy

Named Links requests the pasted URL from your device, without loading its scripts, images or media, and checks the headers first so large files aren't downloaded. YouTube, Vimeo, Spotify and SoundCloud links go to that site's oEmbed API instead. Excluded sites are never requested.

The one opt-in exception: **Fetch X posts through FxTwitter** sends twitter.com and x.com URLs to fxtwitter.com or fixupx.com, a third-party service. There's no telemetry.

## Mobile

Works on Obsidian mobile with the long-press **Paste** action. Some keyboard clipboard shortcuts (Gboard's, for one) don't fire a paste event; use the **Paste URL and fetch its title** command instead.

## How it compares

Going by what each plugin's README documents (October 2026); a dash means it isn't mentioned.

| | Named Links | [Auto Link Title](https://github.com/zolrath/obsidian-auto-link-title) | [URL Namer](https://github.com/zfei/obsidian-url-namer) | [Paste URL into selection](https://github.com/denolehov/obsidian-url-into-selection) | [Links](https://github.com/mii-key/obsidian-links) |
| --- | --- | --- | --- | --- | --- |
| Titles a URL as you paste it | Yes | Yes | Optional | No | No |
| Titles URLs already in a note | Command, at the cursor or across a selection | Command, at the cursor | Command, across a selection | No | When converting a URL to a markdown link |
| Several URLs pasted at once | Each titled | - | - | - | - |
| URL pasted over selected text links that text | Yes, by default | Optional | - | Yes | Command |
| Text pasted over a selected URL becomes its title | Optional | - | - | Command | Command |
| Title clean-up and find/replace rules | Yes | Maximum length only | - | - | - |
| Link format (HTML, custom templates) | Yes | - | - | - | Converts between link types |
| How it reads titles | From the page's HTML, without running the page | A hidden browser window that runs the page, by default | From the page's HTML | Doesn't | From the page's HTML |
| Last updated | October 2026 | December 2024 | April 2026 | August 2025 | March 2026 |

If you only need to turn selected text into a link, Paste URL into selection is lighter, and Links does far more for converting and editing links. Named Links is about getting a good title on a URL with as little effort as possible.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/TESTING.md](docs/TESTING.md). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). If this plugin is useful to you, consider [buying me a coffee](https://buymeacoffee.com/danyim).
