import { EditorView } from '@codemirror/view';
import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  getLanguage,
} from 'obsidian';

import { NamedLinksApi, createApi } from './api';
import { cleanupTitle } from './cleanup';
import { ClipboardLinkData, copiedLinkTitle } from './clipboardTitle';
import { obsidianHttpClient } from './http';
import { t } from './lang';
import { pageFieldsIn, templateFor } from './linkFormat';
import { Linker } from './linker';
import { OEmbedProvider, PageInfo, fetchPageInfo } from './scraper';
import {
  AUTO_LINK_TITLE_ID,
  AUTO_LINK_TITLE_NAME,
  NamedLinksSettings,
  mergeSettings,
  settingsFromAutoLinkTitle,
} from './settings';
import { NamedLinksSettingTab } from './settingsTab';
import { toAbsoluteUrl, unwrapAutolink } from './url';
import { vimPutWatcher } from './vim';

const REQUEST_TIMEOUT_MS = 15 * 1000;

// The longest a Mod+Shift+V keystroke counts as a plain-text paste. Its paste
// events arrive within milliseconds of it; this only bounds the case where
// nothing else happens afterwards.
const PLAIN_PASTE_WINDOW_MS = 500;

function fileOf(info: MarkdownView | MarkdownFileInfo | null): TFile | null {
  return info?.file ?? null;
}

export default class NamedLinksPlugin extends Plugin {
  settings: NamedLinksSettings;
  linker: Linker;

  /**
   * For other plugins and scripts, at
   * `app.plugins.plugins['named-links'].api`. See src/api.ts.
   */
  api: NamedLinksApi;

  /**
   * Whether this vault still holds Auto Link Title's settings, so the
   * settings tab can offer to import them. Re-checked each time the tab
   * opens.
   */
  autoLinkTitleDataAvailable = false;

  /** Every in-flight title lookup, so the tests can wait for them. */
  private inFlight = new Set<Promise<void>>();

  private plainPasteUntil = 0;
  private dragStartedInApp = false;

  /** Per request. A field so the tests can shorten it. */
  requestTimeoutMs = REQUEST_TIMEOUT_MS;

  /** Replaces the built-in oEmbed providers. A field so the tests can. */
  oEmbedProviders: OEmbedProvider[] | undefined = undefined;

  /** Runs a title through the clean-up settings: site name and rules. */
  private cleanUp(title: string, url: string, siteName: string | null) {
    return cleanupTitle(title, {
      url,
      siteName,
      removeSiteName: this.settings.removeSiteName,
      domainRules: this.settings.domainTitleRules,
      pageRules: this.settings.titleRules,
    });
  }

  /**
   * The title a single pasted or dropped URL already carries, cleaned up,
   * or null to fetch one.
   */
  private copiedTitle(text: string, data: DataTransfer | null): string | null {
    if (!data) return null;
    const tokens = text.trim().split(/\s+/);
    if (tokens.length !== 1) return null;
    const url = toAbsoluteUrl(unwrapAutolink(tokens[0]));
    if (!url) return null;
    const carried: ClipboardLinkData = {
      html: data.getData('text/html') || undefined,
      mozUrl: data.getData('text/x-moz-url') || undefined,
    };
    const title = copiedLinkTitle(carried, url);
    return title === null ? null : this.cleanUp(title, url, null);
  }

  /**
   * What the page at a URL says about itself, with its title cleaned up the
   * way the settings ask. The timeout also caps the whole lookup, not just
   * each request: an unresponsive host would otherwise hold the placeholder
   * through the HEAD, the GET and any oEmbed request in turn.
   */
  fetchPageInfo = (url: string): Promise<PageInfo | null> => {
    let timer = 0;
    const deadline = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), this.requestTimeoutMs);
    });
    const lookup = fetchPageInfo(url, {
      http: obsidianHttpClient(this.requestTimeoutMs),
      language: getLanguage(),
      twitterProxy: this.settings.twitterProxy,
      oEmbedProviders: this.oEmbedProviders,
      fields: pageFieldsIn(templateFor(this.settings)),
    }).then((info) =>
      info === null
        ? null
        : { ...info, title: this.cleanUp(info.title, url, info.siteName) }
    );
    return Promise.race([lookup, deadline]).finally(() =>
      window.clearTimeout(timer)
    );
  };

  async onload() {
    await this.loadSettings();
    this.linker = new Linker(this);
    this.api = createApi({
      settings: () => this.settings,
      fetchPageInfo: (url) => this.fetchPageInfo(url),
      link: (url, title, page) => this.linker.link(url, title, false, page),
      wantsTitle: () => this.linker.wantsTitle,
      wantsPageInfo: () => this.linker.wantsPageInfo,
    });

    this.addSettingTab(new NamedLinksSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt, editor, info) => {
        if (evt.defaultPrevented) return;
        // Every paste the chord produces is plain: Obsidian fires two paste
        // events for one Mod+Shift+V. The next keystroke ends it.
        if (Date.now() < this.plainPasteUntil) return;

        const text = evt.clipboardData?.getData('text/plain') ?? '';
        // Its own setting rather than part of titling pasted URLs: nothing
        // is fetched, and the pasted text isn't a URL.
        if (
          this.settings.pasteTitleOntoUrl &&
          this.linker.pasteTitleOntoUrl(editor, text)
        ) {
          evt.preventDefault();
          return;
        }

        if (!this.settings.enhancePaste) return;
        const plan = this.planInsert(
          editor,
          text,
          this.copiedTitle(text, evt.clipboardData)
        );
        if (!plan) return;

        evt.preventDefault();
        this.track(this.linker.insert(editor, fileOf(info), plan));
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-drop', (evt, editor, info) => {
        if (evt.defaultPrevented) return;
        if (!this.settings.enhanceDrop) return;
        // Moving text within Obsidian is a drag that starts here. Taking it
        // over would copy the URL instead of moving it.
        if (this.dragStartedInApp) return;

        const text = evt.dataTransfer?.getData('text/plain') ?? '';
        const pos = this.dropPosition(editor, evt);
        if (pos === null) return;
        editor.setCursor(pos);
        const plan = this.planInsert(
          editor,
          text,
          this.copiedTitle(text, evt.dataTransfer)
        );
        if (!plan) return;

        evt.preventDefault();
        this.track(this.linker.insert(editor, fileOf(info), plan));
      })
    );

    this.registerEditorExtension(
      vimPutWatcher((view, from, to) => this.titleVimPut(view, from, to))
    );

    this.watchWindow(window);
    this.registerEvent(
      this.app.workspace.on('window-open', (_win, popout) =>
        this.watchWindow(popout)
      )
    );

    this.addCommand({
      id: 'paste-url-with-title',
      name: t().commands.pasteWithTitle,
      editorCallback: (editor, info) => {
        void this.pasteWithTitle(editor, fileOf(info));
      },
    });

    this.addCommand({
      id: 'paste-without-title',
      name: t().commands.pasteWithoutTitle,
      editorCallback: (editor) => {
        void this.plainPaste(editor);
      },
    });

    this.addCommand({
      id: 'enhance-url-with-title',
      name: t().commands.enhance,
      editorCallback: (editor, info) => {
        if (!this.checkOnline()) return;
        this.track(this.linker.enhance(editor, fileOf(info)));
      },
    });

    await this.checkForAutoLinkTitleData();
  }

  /**
   * Mod+Shift+V is the system's paste-as-plain-text shortcut, which Obsidian
   * inherits from Chromium rather than binding as a command, and it still
   * fires paste events. Remembering the chord here lets those pastes go
   * through untouched, without this plugin claiming the hotkey itself
   * (upstream #39, #101, #121, #170).
   *
   * The chord counts until the next keystroke rather than for one paste:
   * Obsidian fires two paste events for one Mod+Shift+V, and the second was
   * being titled. Any other key, including the next Mod+V, ends it.
   */
  private watchWindow(win: Window) {
    this.registerDomEvent(
      win,
      'keydown',
      (evt: KeyboardEvent) => {
        if (
          // `code` catches V on layouts whose V key types another letter,
          // `key` catches layouts that put V somewhere else, like Dvorak.
          (evt.code === 'KeyV' || evt.key.toLowerCase() === 'v') &&
          evt.shiftKey &&
          (evt.ctrlKey || evt.metaKey)
        ) {
          this.plainPasteUntil = Date.now() + PLAIN_PASTE_WINDOW_MS;
        } else {
          this.plainPasteUntil = 0;
        }
      },
      { capture: true }
    );
    // A click, such as choosing Paste from a context menu, ends a plain
    // paste too: that paste comes with no keystroke to end it otherwise.
    this.registerDomEvent(
      win,
      'pointerdown',
      () => {
        this.plainPasteUntil = 0;
      },
      { capture: true }
    );
    this.registerDomEvent(win, 'dragstart', () => {
      this.dragStartedInApp = true;
    });
    // dragend goes to the drag's source, which a drop into the editor can
    // re-render out of the document before the event bubbles here. The drop
    // itself reaches the window once the editor has handled it, so either
    // ends the drag.
    for (const type of ['dragend', 'drop'] as const) {
      this.registerDomEvent(win, type, () => {
        this.dragStartedInApp = false;
      });
    }
  }

  /**
   * The editor position under a drop. Upstream inserted at the cursor
   * instead, wherever that had been left before the drag.
   */
  private dropPosition(editor: Editor, evt: DragEvent) {
    const view = (
      editor as Editor & {
        cm?: { posAtCoords(coords: { x: number; y: number }): number | null };
      }
    ).cm;
    const offset = view?.posAtCoords({ x: evt.clientX, y: evt.clientY });
    if (offset === null) return null;
    return offset === undefined
      ? editor.getCursor()
      : editor.offsetToPos(offset);
  }

  private planInsert(
    editor: Editor,
    text: string,
    copiedTitle: string | null = null
  ) {
    // With several cursors the same placeholder would go in at each of them,
    // and only one could ever be replaced.
    if (editor.listSelections().length > 1) return null;
    if (this.linker.isRawContext(editor, editor.getCursor('from'))) {
      return null;
    }
    const plan = this.linker.plan(text, editor.getSelection(), copiedTitle);
    if (!plan) return null;
    if (plan.pending.length > 0 && !this.checkOnline()) return null;
    return plan;
  }

  /**
   * Titles the URLs a vim `p` or `P` just put into a note, under the same
   * setting and rules as a paste (upstream #7).
   */
  private titleVimPut(view: EditorView, from: number, to: number) {
    if (!this.settings.enhancePaste) return;
    const markdown = this.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .find(
        (v): v is MarkdownView =>
          v instanceof MarkdownView &&
          (v.editor as Editor & { cm?: EditorView }).cm === view
      );
    if (!markdown) return;
    const plan = this.linker.planInserted(markdown.editor, from, to);
    if (!plan) return;
    if (plan.pending.length > 0 && !this.checkOnline()) return;
    this.track(
      this.linker.replaceInserted(
        markdown.editor,
        markdown.file,
        from,
        to,
        plan
      )
    );
  }

  private checkOnline(): boolean {
    if (navigator.onLine) return true;
    new Notice(t().notices.offline);
    return false;
  }

  private async pasteWithTitle(editor: Editor, file: TFile | null) {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const plan = this.planInsert(editor, text);
    if (!plan) {
      editor.replaceSelection(text);
      return;
    }
    const done = this.linker.insert(editor, file, plan);
    this.track(done);
    await done;
  }

  private async plainPaste(editor: Editor) {
    const text = await navigator.clipboard.readText();
    if (text) editor.replaceSelection(text);
  }

  private track(work: Promise<void>) {
    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  /** Resolves once every title lookup started so far has been written. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }
  }

  private autoLinkTitleDataPath(): string {
    return `${this.app.vault.configDir}/plugins/${AUTO_LINK_TITLE_ID}/data.json`;
  }

  /** Returns whether the answer changed. */
  async checkForAutoLinkTitleData(): Promise<boolean> {
    const before = this.autoLinkTitleDataAvailable;
    this.autoLinkTitleDataAvailable = await this.app.vault.adapter.exists(
      this.autoLinkTitleDataPath()
    );
    return before !== this.autoLinkTitleDataAvailable;
  }

  /** Copies Auto Link Title's settings over this plugin's. */
  async importAutoLinkTitleSettings(): Promise<void> {
    const raw = await this.app.vault.adapter.read(this.autoLinkTitleDataPath());
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(t().notices.importInvalidJson(AUTO_LINK_TITLE_NAME));
    }
    const imported = settingsFromAutoLinkTitle(parsed);
    if (!imported) {
      throw new Error(t().notices.importEmpty(AUTO_LINK_TITLE_NAME));
    }
    this.settings = mergeSettings({ ...this.settings, ...imported });
    await this.saveSettings();
  }

  /** Whether Auto Link Title is enabled too, and so also handling pastes. */
  autoLinkTitleEnabled(): boolean {
    const plugins = (
      this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }
    ).plugins;
    return plugins?.enabledPlugins?.has(AUTO_LINK_TITLE_ID) ?? false;
  }

  async loadSettings() {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
