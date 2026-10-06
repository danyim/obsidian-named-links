# Commands and settings

Everything Named Links does, command by command and setting by setting. For an overview and examples, see the [README](../README.md).

- [Commands](#commands)
- [Settings](#settings)
- [Link format](#link-format)
- [Decoding URLs](#decoding-urls)
- [Cleaning up titles](#cleaning-up-titles)
- [Excluded sites](#excluded-sites)
- [Scripting](#scripting)

## Commands

None has a default hotkey; set one under Settings → Hotkeys.

| Command | What it does |
| --- | --- |
| Add a title to an existing URL | Titles the URL under the cursor, replacing a `[text](url)` link's text or turning a `<URL>` autolink into a link. With a selection, titles every bare URL in it, skipping code, frontmatter and URLs already in links. |
| Paste URL and fetch its title | Pastes and titles the clipboard's URLs, even with **Title pasted URLs** off. |
| Paste without fetching a title | Pastes the clipboard as it is. |

## Settings

Listed in the order the settings tab shows them.

| Setting | Default | |
| --- | --- | --- |
| **Link format** | | |
| Link format | Markdown link | How a finished link is written. See [Link format](#link-format). |
| Custom format | `[{title}]({url})` | The template used when the link format is Custom. |
| Decode URLs | Off | Write `%E5%AF%BF` as `寿`. See [Decoding URLs](#decoding-urls). |
| **When to fetch titles** | | |
| Title pasted URLs | On | Fetch titles for URLs pasted with the normal paste command. |
| Title dropped URLs | On | Fetch titles for URLs dragged in from another app. |
| Use the selection as the title | On | Pasting a URL over selected text links that text instead of fetching. |
| Paste text onto a selected URL as its title | Off | Pasting text over a selected URL or link makes the text its title. Works with **Title pasted URLs** off too. |
| **Titles** | | |
| Remove the site name | Off | `Video - YouTube` becomes `Video`. See [Cleaning up titles](#cleaning-up-titles). |
| Domain title rules | Empty | Find and replace for one site's titles, run first. |
| Page title rules | Empty | Find and replace for every title, run second. |
| Maximum title length | 0 (no limit) | Shorten longer titles to this many characters, plus `…`. |
| Fetch X posts through FxTwitter | Off | X shows no title without JavaScript, so this looks twitter.com and x.com links up through fxtwitter.com or fixupx.com, a third-party service that then sees those URLs. |
| **Excluded sites** | | |
| Sites | Empty | Never fetched. See [Excluded sites](#excluded-sites). |
| Paste excluded sites as | The URL as it is | Or a link titled with the domain. |

If Auto Link Title's settings are in your vault, the tab also offers to import them, and warns while both plugins are enabled.

## Link format

| Link format | Result |
| --- | --- |
| Markdown link | `[Example Domain](https://example.com)` |
| Markdown link with a hover title | `[Example Domain](https://example.com "Example Domain")` |
| HTML link | `<a href="https://example.com">Example Domain</a>` |
| Custom | Your own template, using the placeholders below |

| Placeholder | Is |
| --- | --- |
| `{title}` | The page's title |
| `{url}`, `{domain}` | The link's URL, and its host without `www.` |
| `{author}` | A video's channel, or the page's author |
| `{site}` | The site's name, such as `YouTube` |
| `{description}` | The page's description |
| `{section}` | The heading a `#fragment` in the URL points to, on pages whose HTML includes their headings |
| `{date}`, `{date:FORMAT}` | Today, as `YYYY-MM-DD` or a [moment.js format](https://momentjs.com/docs/#/displaying/format/) |

A custom format must include `{url}`. One that uses only `{url}`, `{domain}` and `{date}` writes the link straight away, with nothing fetched.

A value the page doesn't have is left out, along with the separator before or after it (a hyphen, dash, `|`, `·`, `•`, `:`, `,`, `/`, `›`, `»` or `→`, with its spaces) or the parentheses around it. So `[{title} ({author})]({url})` on a page with no author is just `[Title](url)`. Each value is escaped for where it sits in the template, so nothing in a page's metadata can break the link.

`{section}` is empty on sites that build their pages with JavaScript, such as Obsidian Publish sites, since Named Links reads the page's HTML without running it.

## Decoding URLs

With **Decode URLs** on, a finished link's URL is written with its percent-escapes decoded, so it's readable and searchable:

| Pasted | Written as |
| --- | --- |
| `https://jisho.org/word/%E5%AF%BF%E5%8F%B8` | `[Title](https://jisho.org/word/寿司)` |
| `https://en.wikipedia.org/wiki/Blue%20jay` | `[Title](<https://en.wikipedia.org/wiki/Blue jay>)` |

Anything that would change where the URL leads or break the markdown stays encoded (`%`, `/ ? # & =` and the other URL delimiters, quotes, brackets and invisible characters). The title is still fetched from the URL as pasted.

## Cleaning up titles

In order: tidy whitespace, remove the site name, run domain title rules, run page title rules, then shorten. Titles you copied along with a link get the same clean-up; titles you selected or pasted yourself don't.

**Remove the site name** drops the first or last part of a title (split on ` | `, ` - `, ` · ` and similar) when it names the site, going by the page's `og:site_name` or its address. It handles abbreviations and a leading "The", and never empties a title.

| Before | After |
| --- | --- |
| `owner/repo: A description · GitHub` | `owner/repo: A description` |
| `An article \| The New York Times` | `An article` |
| `C - The Language` on another site | unchanged |

**Page title rules** are one `pattern => replacement` per line, applied to every title:

```
(Official Video) =>
/^\[(\w+)\] (.*)$/ => $2 ($1)
```

**Domain title rules** start with the site they apply to, subdomains included:

```
github.com: /^GitHub - ([^:]+):.*$/ => $1
*.substack.com: / \| .*$/ =>
```

A pattern is literal text, replaced wherever it appears, unless written `/pattern/flags`, which makes it a regular expression (add `g` to replace every match, and use `$1` for groups). An empty replacement deletes the match. Blank lines and lines starting with `#` are skipped. Invalid lines are skipped too, and flagged in the settings tab. Rules never leave a title empty.

## Excluded sites

One per line, or separated by commas. A domain such as `example.com` also covers its subdomains, so `x.com` matches `www.x.com` but not `netflix.com`. Anything else matches any URL containing it. An excluded site is never requested, and is pasted as the URL or as a link titled with its domain, per **Paste excluded sites as**.

## Scripting

Other plugins and scripts can fetch titles through `app.plugins.plugins['named-links'].api`, using your settings (clean-up, link format, excluded sites). In a [Templater](https://github.com/SilentVoid13/Templater) template, this turns the selected URL into a titled link:

```
<% await app.plugins.plugins['named-links'].api.getLink(tp.file.selection()) %>
```

| Member | Returns |
| --- | --- |
| `getTitle(url)` | The cleaned-up title, not escaped, or `null` if there's none or the site is excluded. |
| `getLink(url)` | The link a paste would write, or the URL as given if no title is found. |
| `formatLink(url, title)` | Your link format applied to a title you already have. Nothing is fetched. |
| `version` | `1`. It only goes up for a breaking change (a method removed, renamed or changed in what it takes or returns); new methods don't change it. |

None of the methods throw; bad input gets `null` or the input back. The types are in [src/api.ts](../src/api.ts).
