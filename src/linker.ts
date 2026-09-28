/**
 * Turns URLs into titled links in an editor: plans what a paste or drop
 * inserts, puts placeholders in straight away, and swaps each for its title
 * once it arrives.
 */
import { App, Editor, EditorPosition, Notice, TFile } from 'obsidian';

import { isInCode, isInFrontmatter, isLinkTargetPosition } from './context';
import { t } from './lang';
import { NamedLinksSettings, isExcluded, parseExcludedSites } from './settings';
import { formatTitle } from './title';
import {
  findLinks,
  hostnameOf,
  isImageUrl,
  linkAt,
  linkDestination,
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

    if (urls.length === 1 && selection.trim() !== '') {
      const url = toAbsoluteUrl(unwrapAutolink(urls[0])) as string;
      if (this.settings.useSelectionAsTitle) {
        return {
          text: `[${selection}](${linkDestination(url)})`,
          pending: [],
        };
      }
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
          ? `[${formatTitle(hostnameOf(url), 0)}](${linkDestination(url)})`
          : token;
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

  /** Inserts a plan at the selection and starts fetching its titles. */
  insert(editor: Editor, file: TFile | null, plan: InsertPlan): Promise<void> {
    editor.replaceSelection(plan.text);
    return this.resolveAll(editor, file, plan.pending);
  }

  async resolveAll(
    editor: Editor,
    file: TFile | null,
    pending: PendingTitle[]
  ): Promise<void> {
    await Promise.all(pending.map((item) => this.resolve(editor, file, item)));
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
        : `[${formatTitle(title, this.settings.maxTitleLength)}](${destination})`;

    const text = editor.getValue();
    const found = locatePlaceholder(text, item.placeholder);
    if (found) {
      editor.replaceRange(
        replacement(found.destination),
        editor.offsetToPos(found.start),
        editor.offsetToPos(found.end)
      );
      return;
    }

    // The editor has moved on to another note, or the note was closed,
    // before the title came back. Finish the link in the file itself rather
    // than leave the placeholder behind.
    if (file) {
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
  }

  /**
   * Titles the URL under the cursor, or every bare URL in the selection. A
   * markdown link under the cursor has its text replaced with the fetched
   * title.
   */
  async enhance(editor: Editor, file: TFile | null): Promise<void> {
    if (editor.somethingSelected()) {
      await this.enhanceSelection(editor, file);
      return;
    }

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const link = linkAt(line, cursor.ch);
    if (!link) {
      new Notice(t().notices.noUrlHere);
      return;
    }

    const url = toAbsoluteUrl(link.url) as string;
    const placeholder = newPlaceholder();
    const from = { line: cursor.line, ch: link.start };
    const to = { line: cursor.line, ch: link.end };
    const original = line.slice(link.start, link.end);
    editor.replaceRange(`[${placeholder}](${linkDestination(url)})`, from, to);
    await this.resolveAll(editor, file, [
      { placeholder, url, fallback: original },
    ]);
  }

  private async enhanceSelection(
    editor: Editor,
    file: TFile | null
  ): Promise<void> {
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const text = editor.getValue();
    const startOffset = editor.posToOffset(from);
    const selected = editor.getSelection();

    const pending: PendingTitle[] = [];
    const lines = selected.split('\n');
    let lineOffset = 0;
    const rewritten = lines.map((line) => {
      const base = startOffset + lineOffset;
      lineOffset += line.length + 1;
      let out = '';
      let last = 0;
      for (const link of findLinks(line)) {
        if (link.text !== undefined) continue;
        if (isInCode(text, base + link.start)) continue;
        const url = toAbsoluteUrl(link.url) as string;
        if (isImageUrl(url)) continue;
        const placeholder = newPlaceholder();
        pending.push({ placeholder, url, fallback: link.url });
        out += line.slice(last, link.start);
        out += `[${placeholder}](${linkDestination(url)})`;
        last = link.end;
      }
      return out + line.slice(last);
    });

    if (pending.length === 0) {
      new Notice(t().notices.noUrlInSelection);
      return;
    }

    editor.replaceRange(rewritten.join('\n'), from, to);
    await this.resolveAll(editor, file, pending);
  }
}
