import { browser } from '@wdio/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { obsidianPage } from 'wdio-obsidian-service';

import type { NamedLinksSettings } from '../src/settings';

export const PLUGIN_ID = 'named-links';

const SCREENSHOT_DIR = path.resolve('test/screenshots');

/** Marks the cursor in editor fixtures. */
export const CURSOR = '‸';

let noteCount = 0;

export interface NoteOptions {
  name?: string;
  /**
   * Open in source mode rather than Live Preview. Live Preview won't hold a
   * cursor set inside markup it hides, like an empty `()` or an inline code
   * span's backticks, and shows frontmatter as a properties widget rather
   * than editor text.
   */
  source?: boolean;
}

/**
 * Opens a fresh note holding `content`, with the cursor where `‸` is, or the
 * text between `«` and `»` selected.
 */
export async function openNote(
  content: string,
  options: NoteOptions = {}
): Promise<void> {
  const name = options.name ?? `Scratch ${++noteCount}.md`;
  // resetVault reads an empty string as "no content given" and goes looking
  // for a source file instead, so the note starts non-empty and is replaced
  // by setValue below.
  await obsidianPage.resetVault({ [name]: '-' });
  // A fresh name each time: Obsidian restores a note's last cursor position
  // shortly after opening it, which would move the cursor set below.
  await browser.executeObsidian(
    async ({ app }, name, source) => {
      const file = app.vault.getFileByPath(name);
      if (!file) throw new Error(`No such note: ${name}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, {
        state: { mode: 'source', source },
      });
    },
    name,
    options.source ?? false
  );
  await browser.executeObsidian(({ app, obsidian }, fixture) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (!view) throw new Error('No markdown view is active');
    const editor = view.editor;

    const selStart = fixture.indexOf('«');
    const cursor = fixture.indexOf('‸');
    const text = fixture.replace(/[«»‸]/g, '');
    editor.setValue(text);
    editor.focus();
    if (selStart >= 0) {
      const selEnd = fixture.indexOf('»') - 1;
      editor.setSelection(
        editor.offsetToPos(selStart),
        editor.offsetToPos(selEnd)
      );
    } else {
      editor.setCursor(editor.offsetToPos(cursor >= 0 ? cursor : text.length));
    }
  }, content);
}

/** The active editor's text, with `‸` at the cursor. */
export function editorText(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const editor = app.workspace.getActiveViewOfType(
      obsidian.MarkdownView
    )!.editor;
    const text = editor.getValue();
    const offset = editor.posToOffset(editor.getCursor());
    return text.slice(0, offset) + '‸' + text.slice(offset);
  });
}

export function editorValue(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    return app.workspace
      .getActiveViewOfType(obsidian.MarkdownView)!
      .editor.getValue();
  });
}

/**
 * Pastes `text` into the active editor the way a real paste arrives: as a
 * paste event on CodeMirror's content element, which is where Obsidian
 * raises `editor-paste`. CodeMirror calls preventDefault on every paste it
 * handles itself, so whether the plugin acted shows in the text, not the
 * event.
 *
 * `plain` presses Mod+Shift+V first, as pasting as plain text does.
 */
export async function paste(
  text: string,
  options: { plain?: boolean } = {}
): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, text, plain) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      const content = (view.editor as any).cm.contentDOM as HTMLElement;
      if (plain) {
        content.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'V',
            code: 'KeyV',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          })
        );
      }
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const evt = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      content.dispatchEvent(evt);
    },
    text,
    options.plain ?? false
  );
}

/**
 * Drops `text` onto the editor at document offset `offset`, as if dragged in
 * from another app.
 */
export function drop(text: string, offset: number): Promise<boolean> {
  return browser.executeObsidian(
    ({ app, obsidian }, text, offset) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      const cm = (view.editor as any).cm;
      const coords = cm.coordsAtPos(offset);
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const evt = new DragEvent('drop', {
        dataTransfer: data,
        clientX: coords.left + 1,
        clientY: (coords.top + coords.bottom) / 2,
        bubbles: true,
        cancelable: true,
      });
      cm.contentDOM.dispatchEvent(evt);
      return evt.defaultPrevented;
    },
    text,
    offset
  );
}

/** Waits until every title lookup the plugin has started is written. */
export async function settled(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    await (app as any).plugins.plugins['named-links'].settled();
  });
}

export async function setSettings(
  settings: Partial<NamedLinksSettings>
): Promise<void> {
  await browser.executeObsidian(async ({ app }, settings) => {
    const p = (app as any).plugins.plugins['named-links'];
    p.settings = { ...p.settings, ...settings };
    await p.saveSettings();
  }, settings);
}

export function getSettings(): Promise<NamedLinksSettings> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['named-links'];
    return JSON.parse(JSON.stringify(p.settings));
  });
}

/** Restores default settings and the default request timeout. */
export async function resetPlugin(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const p = (app as any).plugins.plugins['named-links'];
    await p.settled();
    p.settings = {
      enhancePaste: true,
      enhanceDrop: true,
      useSelectionAsTitle: true,
      skipCodeAndFrontmatter: true,
      maxTitleLength: 0,
      removeSiteName: false,
      titleRules: '',
      twitterProxy: false,
      excludedSites: '',
      excludedSiteFormat: 'url',
    };
    p.requestTimeoutMs = 15000;
    await p.saveSettings();
  });
}

/**
 * Turns Auto Link Title off and deletes its settings, whatever an earlier
 * spec in the same Obsidian left behind.
 */
export async function removeAutoLinkTitle(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const plugins = (app as any).plugins;
    if (plugins.enabledPlugins.has('obsidian-auto-link-title')) {
      await plugins.disablePluginAndSave('obsidian-auto-link-title');
    }
    const path = `${app.vault.configDir}/plugins/obsidian-auto-link-title/data.json`;
    if (await app.vault.adapter.exists(path)) {
      await app.vault.adapter.remove(path);
    }
    await plugins.plugins['named-links'].checkForAutoLinkTitleData();
  });
}

export async function runCommand(id: string): Promise<void> {
  await browser.executeObsidian(({ app }, id) => {
    const ok = (app as any).commands.executeCommandById(`named-links:${id}`);
    if (!ok) throw new Error(`Command ${id} didn't run`);
  }, id);
}

/** Makes navigator.clipboard.readText() answer `text`. */
export async function stubClipboard(text: string): Promise<void> {
  await browser.executeObsidian((_, text) => {
    Object.defineProperty(navigator.clipboard, 'readText', {
      configurable: true,
      value: () => Promise.resolve(text),
    });
  }, text);
}

/** The text of every notice currently on screen. */
export function notices(): Promise<string[]> {
  return browser.executeObsidian(() =>
    Array.from(document.querySelectorAll('.notice')).map(
      (el) => el.textContent ?? ''
    )
  );
}

export async function clearNotices(): Promise<void> {
  await browser.executeObsidian(() => {
    document.querySelectorAll('.notice').forEach((el) => el.remove());
  });
}

export function isMobile(): Promise<boolean> {
  return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

/**
 * Captures the screen, tagged with the Obsidian version and platform so a
 * run across the version matrix leaves one file per combination.
 */
export async function captureRendering(
  name: string,
  options: { window?: 'main' | 'newest' } = {}
): Promise<string> {
  const [version, mobile] = await Promise.all([
    browser.executeObsidian(({ obsidian }) => obsidian.apiVersion),
    isMobile(),
  ]);
  const platform = mobile ? 'mobile' : 'desktop';
  const file = path.join(SCREENSHOT_DIR, `${version}-${platform}-${name}.png`);
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  // Desktop Obsidian opens some things, settings included, in a window of
  // their own, which a screenshot of the main window doesn't show.
  const handles = await browser.getWindowHandles();
  const main = await browser.getWindowHandle();
  const target =
    options.window === 'newest' ? handles[handles.length - 1] : main;
  if (target !== main) await browser.switchToWindow(target);
  try {
    await browser.saveScreenshot(file);
  } finally {
    if (target !== main) await browser.switchToWindow(main);
  }
  return file;
}
