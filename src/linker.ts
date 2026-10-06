/**
 * Turns URLs into titled links in an editor: plans what a paste or drop
 * inserts, puts placeholders in straight away, and swaps each for its title
 * once it arrives.
 */
import { EditorView } from '@codemirror/view';
import {
  App,
  Editor,
  EditorChange,
  EditorPosition,
  MarkdownView,
  Notice,
  TFile,
  moment,
} from 'obsidian';

import { isInCode, isInFrontmatter, isLinkTargetPosition } from './context';
import { changeTracked, finishPlaceholder, insertTracked } from './history';
import { t } from './lang';
import {
  needsPageInfo,
  needsTitle,
  pageFieldsIn,
  renderLink,
  templateFor,
} from './linkFormat';
import type { PageInfo } from './scraper';
import { NamedLinksSettings, isExcluded, parseExcludedSites } from './settings';
import { readableTitle } from './title';
import {
  decodeUrlForDisplay,
  findLinks,
  hostnameOf,
  isImageUrl,
  linkAt,
  linkDestination,
  titleOntoUrl,
  toAbsoluteUrl,
  unwrapAutolink,
} from './url';

export type PageInfoFetcher = (url: string) => Promise<PageInfo | null>;

export interface LinkerHost {
  app: App;
  settings: NamedLinksSettings;
  fetchPageInfo: PageInfoFetcher;
}

interface PendingTitle {
  placeholder: string;
  url: string;
  /** What goes back in place of the placeholder if no title is found. */
  fallback: string;
  /**
   * A title already known, when the lookup is only for the format's other
   * placeholders: a selection used as the title, or the link text a paste
   * carried.
   */
  knownTitle?: string;
  /**
   * Whether `knownTitle` is the user's own markdown, kept as it is (a
   * selection), rather than text from a page, escaped like a fetched title.
   */
  knownTitleIsMarkdown?: boolean;
}

export interface InsertPlan {
  text: string;
  pending: PendingTitle[];
}

/**
 * Obsidian's bundled moment, as much of it as `{date}` uses. Obsidian types
 * `moment` with the moment package's own typings, which don't always
 * resolve where the code is checked (Obsidian's plugin review can't find
 * them), and without them every use of it lints as unsafe.
 */
const now = moment as unknown as () => { format(format: string): string };

let placeholderCount = 0;

/**
 * A placeholder that reads as "Fetching title…" but is unique in the
 * document, via a suffix of zero-width characters. Upstream appended a
 * visible random id, which was left in the note whenever a fetch never
 * settled (upstream #167).
 */
function newPlaceholder(): string {
  placeholderCount = (placeholderCount + 1) % 0x10000;
  const id = (Math.floor(Math.random() * 0x10000) << 16) | placeholderCount;
  let suffix = '';
  for (let bit = 31; bit >= 0; bit--) {
    suffix += (id >>> bit) & 1 ? '\u200c' : '\u200b';
  }
  return t().placeholder + suffix;
}

// The destination of the link a placeholder heads, matched from just after
// its "](". Accepts whatever the user may have edited it to meanwhile.
const DESTINATION = /^(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/;

function stripAngles(destination: string): string {
  return destination.startsWith('<') && destination.endsWith('>')
    ? destination.slice(1, -1)
    : destination;
}

function locatePlaceholder(
  text: string,
  placeholder: string
): { start: number; end: number; destination: string } | null {
  const head = `[${placeholder}](`;
  const start = text.indexOf(head);
  if (start < 0) return null;
  const match = DESTINATION.exec(text.slice(start + head.length));
  if (!match) return null;
  return {
    start,
    end: start + head.length + match[0].length,
    destination: match[1],
  };
}

export class Linker {
  constructor(private host: LinkerHost) {}

  private get settings(): NamedLinksSettings {
    return this.host.settings;
  }

  /**
   * The finished link for a URL, in the format the settings select, with
   * the URL decoded for reading if the settings ask for it (#6). Every
   * finished link goes through here; the request and the fallback for a
   * missing title use the URL as it came.
   */
  link(
    url: string,
    title: string,
    titleIsMarkdown = false,
    page: PageInfo | null = null
  ): string {
    return renderLink(templateFor(this.settings), {
      url: this.settings.decodeUrls ? decodeUrlForDisplay(url) : url,
      title,
      titleIsMarkdown,
      author: page?.author,
      site: page?.siteName,
      description: page?.description,
      section: page?.section,
      formatDate: (format) => now().format(format),
    });
  }

  /** Whether the link format shows a title. */
  get wantsTitle(): boolean {
    return needsTitle(templateFor(this.settings));
  }

  /**
   * Whether the link format shows anything read from the page, and so
   * whether to fetch it. A format of only `{url}`, `{domain}` and `{date}`
   * is written straight away.
   */
  get wantsPageInfo(): boolean {
    return needsPageInfo(templateFor(this.settings));
  }

  /**
   * Whether a URL landing at `pos` should be inserted untouched because of
   * where it is going: into code, frontmatter, or an existing link's target.
   *
   * Not configurable. No one upstream asked for links in code, and a link in
   * frontmatter is only ever written in source mode, as unquoted YAML that
   * breaks the note's properties: a paste into a Properties field never
   * reaches the plugin at all.
   */
  isRawContext(editor: Editor, pos: EditorPosition): boolean {
    const lineBefore = editor.getLine(pos.line).slice(0, pos.ch);
    if (isLinkTargetPosition(lineBefore)) return true;
    const text = editor.getValue();
    const offset = editor.posToOffset(pos);
    return isInFrontmatter(text, offset) || isInCode(text, offset);
  }

  /**
   * What to insert for pasted or dropped text, or null to let Obsidian insert
   * it as usual. `selection` is the text being replaced, if any.
   *
   * Every whitespace-separated token has to be a URL; anything else is prose
   * with a URL in it, which is pasted as it is.
   *
   * `copiedTitle` is the title a single pasted or dropped URL already
   * carried, cleaned up as a fetched title would be. It's used instead of
   * fetching one, so the link is finished straight away.
   */
  plan(
    text: string,
    selection: string,
    copiedTitle: string | null = null
  ): InsertPlan | null {
    // Odd indexes hold the whitespace between tokens; the ends can be empty.
    const tokens = text.split(/(\s+)/);
    const urls = tokens.filter((t, i) => i % 2 === 0 && t !== '');
    if (
      urls.length === 0 ||
      !urls.every((u) => toAbsoluteUrl(unwrapAutolink(u)) !== null)
    ) {
      return null;
    }

    // A selection running over several lines can't be link text.
    if (
      urls.length === 1 &&
      this.settings.useSelectionAsTitle &&
      selection.trim() !== '' &&
      !selection.includes('\n')
    ) {
      const url = toAbsoluteUrl(unwrapAutolink(urls[0])) as string;
      // The selection is the title, but a format that also shows the
      // author, site, description or section still needs the page for
      // those. Without it, the link with only the selection is final.
      const withSelection = this.link(url, selection, true);
      if (pageFieldsIn(templateFor(this.settings)).length === 0) {
        return { text: withSelection, pending: [] };
      }
      const placeholder = newPlaceholder();
      return {
        text: `[${placeholder}](${linkDestination(url)})`,
        pending: [
          {
            placeholder,
            url,
            fallback: withSelection,
            knownTitle: selection,
            knownTitleIsMarkdown: true,
          },
        ],
      };
    }

    const excluded = parseExcludedSites(this.settings.excludedSites);
    const pending: PendingTitle[] = [];
    const out = tokens.map((token, i) => {
      if (i % 2 === 1 || token === '') return token;
      const url = toAbsoluteUrl(unwrapAutolink(token)) as string;
      // An image URL has no <title>; it stays as pasted so it can still
      // be embedded.
      if (isImageUrl(url)) return token;
      if (isExcluded(url, excluded)) {
        return this.settings.excludedSiteFormat === 'domain'
          ? this.link(url, hostnameOf(url))
          : token;
      }
      // A format showing nothing from the page is finished straight away,
      // unfetched.
      if (!this.wantsPageInfo) return this.link(url, '');
      if (copiedTitle && urls.length === 1) {
        const title = readableTitle(copiedTitle, this.settings.maxTitleLength);
        const withCopied = this.link(url, title);
        // As with a selection: the copied text is the title, and a lookup
        // only happens for the format's other placeholders.
        if (pageFieldsIn(templateFor(this.settings)).length === 0) {
          return withCopied;
        }
        const placeholder = newPlaceholder();
        pending.push({
          placeholder,
          url,
          fallback: withCopied,
          knownTitle: title,
          knownTitleIsMarkdown: false,
        });
        return `[${placeholder}](${linkDestination(url)})`;
      }
      const placeholder = newPlaceholder();
      pending.push({ placeholder, url, fallback: token });
      return `[${placeholder}](${linkDestination(url)})`;
    });

    const inserted = out.join('');
    // Nothing to fetch and nothing rewritten: the default paste does the
    // same, and keeps whatever else it does (undo grouping, the selection).
    if (pending.length === 0 && inserted === text) return null;
    return { text: inserted, pending };
  }

  /**
   * Pasting text over a selected URL, or over a whole link, makes that text
   * the link's title (issue #7): the reverse of using the selection as the
   * title. Nothing is fetched. Returns whether it took the paste; anything
   * that doesn't qualify is left to the ordinary paste.
   */
  pasteTitleOntoUrl(editor: Editor, clipboard: string): boolean {
    if (!editor.somethingSelected() || editor.listSelections().length > 1) {
      return false;
    }
    // A link format without the title would throw the pasted text away.
    if (!this.wantsTitle) return false;
    const target = titleOntoUrl(editor.getSelection(), clipboard);
    if (!target) return false;
    // Check where the URL itself starts, not the selection: whitespace
    // selected around it can begin outside the code block or frontmatter
    // the URL sits in, such as the line break after a fence's opener.
    const urlStart = editor.offsetToPos(
      editor.posToOffset(editor.getCursor('from')) + target.before.length
    );
    if (this.isRawContext(editor, urlStart)) return false;
    const text =
      target.before + this.link(target.url, target.title, true) + target.after;
    // An undo event of its own, so one undo gives the URL back.
    if (!insertTracked(editor, text, [])) editor.replaceSelection(text);
    return true;
  }

  /** Inserts a plan at the selection and starts fetching its titles. */
  insert(editor: Editor, file: TFile | null, plan: InsertPlan): Promise<void> {
    const links = plan.pending.map(({ placeholder, fallback }) => {
      const found = locatePlaceholder(plan.text, placeholder);
      const link = found ? plan.text.slice(found.start, found.end) : '';
      return { link, fallback };
    });
    if (!insertTracked(editor, plan.text, links)) {
      editor.replaceSelection(plan.text);
    }
    return this.resolveAll(editor, file, plan.pending);
  }

  /**
   * What to put in place of text that was just inserted at `from`..`to`
   * (offsets), by the same rules as a paste, or null to leave it. For vim's
   * `p` and `P` (upstream #7), which insert without a paste event.
   */
  planInserted(editor: Editor, from: number, to: number): InsertPlan | null {
    const text = editor.getValue().slice(from, to);
    // A charwise put with a count runs copies of a URL together into one
    // token that still parses as a URL; fetching that would only fail.
    const runTogether = text
      .trim()
      .split(/\s+/)
      .some((token) => (token.match(/https?:\/\/|www\./gi) ?? []).length > 1);
    if (runTogether) return null;
    const lead = text.length - text.trimStart().length;
    if (this.isRawContext(editor, editor.offsetToPos(from + lead))) {
      return null;
    }
    const plan = this.plan(text, '');
    return plan && plan.text !== text ? plan : null;
  }

  /**
   * Puts `plan` in place of the text at `from`..`to` and starts fetching its
   * titles. One undo event, so the first undo after the titles arrive gives
   * back what was inserted, as with a paste.
   */
  replaceInserted(
    editor: Editor,
    file: TFile | null,
    from: number,
    to: number,
    plan: InsertPlan
  ): Promise<void> {
    const links = plan.pending.map(({ placeholder, fallback }) => {
      const found = locatePlaceholder(plan.text, placeholder);
      const link = found ? plan.text.slice(found.start, found.end) : '';
      return { link, fallback };
    });
    const range = {
      from: editor.offsetToPos(from),
      to: editor.offsetToPos(to),
    };
    if (!changeTracked(editor, [{ ...range, text: plan.text }], links)) {
      editor.replaceRange(plan.text, range.from, range.to);
    }
    return this.resolveAll(editor, file, plan.pending);
  }

  async resolveAll(
    editor: Editor,
    file: TFile | null,
    pending: PendingTitle[]
  ): Promise<void> {
    await Promise.all(pending.map((item) => this.resolve(editor, file, item)));
  }

  /** The editors of every open markdown view showing `file`. */
  private editorsShowing(file: TFile): Editor[] {
    return this.host.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .filter(
        (view): view is MarkdownView =>
          view instanceof MarkdownView && view.file?.path === file.path
      )
      .map((view) => view.editor);
  }

  private async resolve(
    editor: Editor,
    file: TFile | null,
    item: PendingTitle
  ): Promise<void> {
    let page: PageInfo | null = null;
    try {
      page = await this.host.fetchPageInfo(item.url);
    } catch (e) {
      console.error('Named Links: fetching a title failed', e);
    }
    const title = page?.title ?? null;

    // A known title still makes a link when the page can't be read: the
    // fallback is that link with the page's fields empty, so there is
    // nothing to tell the user.
    if (title === null && item.knownTitle === undefined) {
      new Notice(t().notices.noTitle(hostnameOf(item.url)));
    }

    const replacement = (destination: string) =>
      item.knownTitle !== undefined
        ? this.link(
            stripAngles(destination),
            item.knownTitle,
            item.knownTitleIsMarkdown ?? false,
            page
          )
        : title === null
          ? item.fallback
          : this.link(
              stripAngles(destination),
              readableTitle(title, this.settings.maxTitleLength),
              false,
              page
            );

    // The editor that took the paste, if it is still on screen, then any
    // other editor showing the note. A closed editor's document can still
    // hold the placeholder, but nothing would ever save a change made there.
    const showing = file ? this.editorsShowing(file) : [];
    const editors = isLive(editor) ? [editor, ...showing] : showing;
    for (const candidate of editors) {
      const found = locatePlaceholder(candidate.getValue(), item.placeholder);
      if (found) {
        finishPlaceholder(
          candidate,
          found.start,
          found.end,
          item.fallback,
          title === null ? null : replacement(found.destination)
        );
        return;
      }
    }

    // An open note without the placeholder is one the user has undone or
    // typed over it in; writing the file would bring it back, or drop edits
    // not yet saved. Only a markdown file can be edited as text: a canvas
    // card's file is JSON.
    if (!file || showing.length > 0 || file.extension !== 'md') return;

    // The editor moved on to another note, or was closed, before the title
    // came back. Finish the link in the file rather than leave the
    // placeholder behind.
    await this.host.app.vault.process(file, (data) => {
      const inFile = locatePlaceholder(data, item.placeholder);
      if (!inFile) return data;
      return (
        data.slice(0, inFile.start) +
        replacement(inFile.destination) +
        data.slice(inFile.end)
      );
    });
  }

  /**
   * Titles the URL under the cursor, or every bare URL the selection
   * touches. A markdown link under the cursor has its text replaced with the
   * fetched title.
   */
  async enhance(editor: Editor, file: TFile | null): Promise<void> {
    if (editor.somethingSelected()) {
      await this.enhanceSelection(editor, file);
      return;
    }

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const link = linkAt(line, cursor.ch);
    const url = link && (toAbsoluteUrl(link.url) as string);
    if (
      !link ||
      !url ||
      isImageUrl(url) ||
      isInCode(
        editor.getValue(),
        editor.posToOffset({ line: cursor.line, ch: link.start })
      )
    ) {
      new Notice(t().notices.noUrlHere);
      return;
    }

    const from = { line: cursor.line, ch: link.start };
    const to = { line: cursor.line, ch: link.end };
    if (!this.wantsPageInfo) {
      editor.replaceRange(this.link(url, ''), from, to);
      return;
    }
    const placeholder = newPlaceholder();
    const original = line.slice(link.start, link.end);
    const text = `[${placeholder}](${linkDestination(url)})`;
    if (
      !changeTracked(
        editor,
        [{ from, to, text }],
        [{ link: text, fallback: original }]
      )
    ) {
      editor.replaceRange(text, from, to);
    }
    await this.resolveAll(editor, file, [
      { placeholder, url, fallback: original },
    ]);
  }

  /**
   * Every bare URL the selection touches, whole: a selection that starts or
   * ends partway through a URL still titles all of it, rather than linking
   * the part selected and leaving the rest trailing after the link.
   */
  private async enhanceSelection(
    editor: Editor,
    file: TFile | null
  ): Promise<void> {
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const text = editor.getValue();

    const pending: PendingTitle[] = [];
    const changes: EditorChange[] = [];
    for (let ln = from.line; ln <= to.line; ln++) {
      const line = editor.getLine(ln);
      const selStart = ln === from.line ? from.ch : 0;
      const selEnd = ln === to.line ? to.ch : line.length;
      for (const link of findLinks(line)) {
        if (link.text !== undefined) continue;
        if (link.end <= selStart || link.start >= selEnd) continue;
        const offset = editor.posToOffset({ line: ln, ch: link.start });
        if (isInCode(text, offset) || isInFrontmatter(text, offset)) continue;
        const url = toAbsoluteUrl(link.url) as string;
        if (isImageUrl(url)) continue;
        const range = {
          from: { line: ln, ch: link.start },
          to: { line: ln, ch: link.end },
        };
        if (!this.wantsPageInfo) {
          changes.push({ ...range, text: this.link(url, '') });
          continue;
        }
        const placeholder = newPlaceholder();
        pending.push({
          placeholder,
          url,
          fallback: line.slice(link.start, link.end),
        });
        changes.push({
          ...range,
          text: `[${placeholder}](${linkDestination(url)})`,
        });
      }
    }

    if (changes.length === 0) {
      new Notice(t().notices.noUrlInSelection);
      return;
    }

    // A link format without a title finishes every link here and now, with
    // nothing pending for the undo history to track.
    if (pending.length === 0) {
      editor.transaction({ changes });
      return;
    }

    // One transaction, so a single undo reverts every URL.
    const links = changes.map((change, i) => ({
      link: change.text,
      fallback: pending[i].fallback,
    }));
    if (!changeTracked(editor, changes, links)) {
      editor.transaction({ changes });
    }
    await this.resolveAll(editor, file, pending);
  }
}

interface CodeMirrorHandle {
  cm?: EditorView;
}

/** Whether an editor is still mounted, rather than torn down with its tab. */
function isLive(editor: Editor): boolean {
  const view = (editor as Editor & CodeMirrorHandle).cm;
  return view ? view.dom.isConnected : true;
}
