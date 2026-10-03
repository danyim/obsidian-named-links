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
} from 'obsidian';

import { isInCode, isInFrontmatter, isLinkTargetPosition } from './context';
import { changeTracked, finishPlaceholder, insertTracked } from './history';
import { t } from './lang';
import { needsTitle, renderLink, templateFor } from './linkFormat';
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

export type TitleFetcher = (url: string) => Promise<string | null>;

export interface LinkerHost {
  app: App;
  settings: NamedLinksSettings;
  fetchTitle: TitleFetcher;
}

interface PendingTitle {
  placeholder: string;
  url: string;
  /** What goes back in place of the placeholder if no title is found. */
  fallback: string;
}

export interface InsertPlan {
  text: string;
  pending: PendingTitle[];
}

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
  private link(url: string, title: string, titleIsMarkdown = false): string {
    return renderLink(templateFor(this.settings), {
      url: this.settings.decodeUrls ? decodeUrlForDisplay(url) : url,
      title,
      titleIsMarkdown,
    });
  }

  /** Whether the link format shows a title, and so whether to fetch one. */
  private get wantsTitle(): boolean {
    return needsTitle(templateFor(this.settings));
  }

  /**
   * Whether a URL landing at `pos` should be inserted untouched because of
   * where it is going: into code, frontmatter, or an existing link's target.
   */
  isRawContext(editor: Editor, pos: EditorPosition): boolean {
    const lineBefore = editor.getLine(pos.line).slice(0, pos.ch);
    if (isLinkTargetPosition(lineBefore)) return true;
    if (!this.settings.skipCodeAndFrontmatter) return false;
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
   */
  plan(text: string, selection: string): InsertPlan | null {
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
      return { text: this.link(url, selection, true), pending: [] };
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
      // A format without the title is finished straight away, unfetched.
      if (!this.wantsTitle) return this.link(url, '');
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
    let title: string | null = null;
    try {
      title = await this.host.fetchTitle(item.url);
    } catch (e) {
      console.error('Named Links: fetching a title failed', e);
    }

    if (title === null) {
      new Notice(t().notices.noTitle(hostnameOf(item.url)));
    }

    const replacement = (destination: string) =>
      title === null
        ? item.fallback
        : this.link(
            stripAngles(destination),
            readableTitle(title, this.settings.maxTitleLength)
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
    if (!this.wantsTitle) {
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
        if (!this.wantsTitle) {
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
