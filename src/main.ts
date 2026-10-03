import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  getLanguage,
} from 'obsidian';

import { cleanupTitle } from './cleanup';
import { obsidianHttpClient } from './http';
import { t } from './lang';
import { Linker } from './linker';
import { fetchTitle } from './scraper';
import {
  AUTO_LINK_TITLE_ID,
  AUTO_LINK_TITLE_NAME,
  NamedLinksSettings,
  mergeSettings,
  settingsFromAutoLinkTitle,
} from './settings';
import { NamedLinksSettingTab } from './settingsTab';

const REQUEST_TIMEOUT_MS = 15 * 1000;

// How long after Mod+Shift+V a paste still counts as a plain-text paste.
const PLAIN_PASTE_WINDOW_MS = 1000;

function fileOf(info: MarkdownView | MarkdownFileInfo | null): TFile | null {
  return info?.file ?? null;
}

export default class NamedLinksPlugin extends Plugin {
  settings: NamedLinksSettings;
  linker: Linker;

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

  /**
   * The timeout also caps the whole lookup, not just each request: an
   * unresponsive host would otherwise hold the placeholder through the HEAD,
   * the GET and any oEmbed request in turn.
   */
  fetchTitle = (url: string): Promise<string | null> => {
    let timer = 0;
    const deadline = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), this.requestTimeoutMs);
    });
    let siteName: string | null = null;
    const lookup = fetchTitle(url, {
      http: obsidianHttpClient(this.requestTimeoutMs),
      language: getLanguage(),
      twitterProxy: this.settings.twitterProxy,
      onSiteName: (name) => {
        siteName = name;
      },
    }).then((title) =>
      title === null
        ? null
        : cleanupTitle(title, {
            url,
            siteName,
            removeSiteName: this.settings.removeSiteName,
            domainRules: this.settings.domainTitleRules,
            pageRules: this.settings.titleRules,
          })
    );
    return Promise.race([lookup, deadline]).finally(() =>
      window.clearTimeout(timer)
    );
  };

  async onload() {
    await this.loadSettings();
    this.linker = new Linker(this);

    this.addSettingTab(new NamedLinksSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt, editor, info) => {
        if (evt.defaultPrevented) return;
        // The chord marks one paste as plain, not every paste after it.
        const plain = Date.now() < this.plainPasteUntil;
        this.plainPasteUntil = 0;
        if (plain || !this.settings.enhancePaste) return;

        const text = evt.clipboardData?.getData('text/plain') ?? '';
        const plan = this.planInsert(editor, text);
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
        const plan = this.planInsert(editor, text);
        if (!plan) return;

        evt.preventDefault();
        this.track(this.linker.insert(editor, fileOf(info), plan));
      })
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
   * Obsidian's own shortcut for pasting as plain text is Mod+Shift+V, and it
   * still fires a paste event. Remembering the chord here lets that paste go
   * through untouched, without this plugin claiming the hotkey itself
   * (upstream #39, #101, #121, #170). `code` rather than `key` so it works
   * with any keyboard layout.
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
        }
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

  private planInsert(editor: Editor, text: string) {
    // With several cursors the same placeholder would go in at each of them,
    // and only one could ever be replaced.
    if (editor.listSelections().length > 1) return null;
    if (this.linker.isRawContext(editor, editor.getCursor('from'))) {
      return null;
    }
    const plan = this.linker.plan(text, editor.getSelection());
    if (!plan) return null;
    if (plan.pending.length > 0 && !this.checkOnline()) return null;
    return plan;
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
