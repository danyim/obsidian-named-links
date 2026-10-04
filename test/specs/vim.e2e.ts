import { browser, expect } from '@wdio/globals';

import {
  editorValue,
  isMobile,
  resetPlugin,
  setSettings,
  settled,
} from '../helpers';
import {
  clearRequestLog,
  fixtureBase,
  requestLog,
  stopFixtureServer,
} from '../server';

async function setVimMode(on: boolean): Promise<void> {
  await browser.executeObsidian(({ app }, on) => {
    (app as any).vault.setConfig('vimMode', on);
  }, on);
  await browser.pause(300);
}

let noteCount = 0;

/**
 * Opens a new note holding `content`, with the cursor at its end. Made with
 * vault.create rather than the shared openNote, whose vault reset makes
 * Obsidian read its config back from disk half a second later, before
 * setConfig's write has landed, and so turns vim mode off under the spec.
 */
async function openVimNote(content: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, name, content) => {
      const file = await app.vault.create(name, content);
      await app.workspace.getLeaf(false).openFile(file);
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      view.editor.setCursor(view.editor.offsetToPos(content.length));
    },
    `Vim ${++noteCount}.md`,
    content
  );
}

/**
 * Waits until the active editor has vim attached and focused. A note opened
 * moments ago may not have it yet, and keys pressed before then are typed
 * into the note as text. Obsidian can also read its config back from disk
 * while a spec runs and turn vim mode off again, which on a loaded machine
 * left vim unattached for good (seen on 1.13.4 with every spec file running),
 * so the setting is put back whenever it reads as off.
 */
async function waitForVim(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.executeObsidian(({ app, obsidian }) => {
        const vault = (app as any).vault;
        if (!vault.getConfig('vimMode')) vault.setConfig('vimMode', true);
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (!view) return false;
        const cm = (view.editor as any).cm;
        view.editor.focus();
        return !!cm?.cm?.state?.vim && !!cm.hasFocus;
      }),
    { timeout: 15000, interval: 100, timeoutMsg: 'vim never attached' }
  );
}

/**
 * Presses `keys` as real keystrokes, from normal mode, and waits for any
 * titles they started. Vim reads each key itself, so they go one at a time
 * through WebDriver rather than as synthetic events.
 */
async function vim(...keys: string[]): Promise<void> {
  await waitForVim();
  await browser.keys(['Escape']);
  for (const key of keys) await browser.keys([key]);
  await browser.pause(200);
  await settled();
}

// Vim's `p` and `P` insert the register without a paste event (upstream #7).
describe('Putting a URL in vim mode', function () {
  let base: string;
  let url: string;

  before(async function () {
    // Obsidian has no vim mode on mobile.
    if (await isMobile()) this.skip();
    base = await fixtureBase();
    url = `${base}/page?title=Put`;
  });

  after(async function () {
    await setVimMode(false);
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
    await setVimMode(true);
    clearRequestLog();
  });

  it('titles a line put below with p', async function () {
    await openVimNote(`first\n${url}\nlast`);
    await vim('g', 'g', 'j', 'y', 'y', 'G', 'p');
    expect(await editorValue()).toBe(`first\n${url}\nlast\n[Put](${url})`);
  });

  it('titles a line put above with P', async function () {
    await openVimNote(`first\n${url}\nlast`);
    await vim('g', 'g', 'j', 'y', 'y', 'g', 'g', 'P');
    expect(await editorValue()).toBe(`[Put](${url})\nfirst\n${url}\nlast`);
  });

  it('titles each line of a put with a count', async function () {
    await openVimNote(`first\n${url}\nlast`);
    await vim('g', 'g', 'j', 'y', 'y', 'G', '2', 'p');
    expect(await editorValue()).toBe(
      `first\n${url}\nlast\n[Put](${url})\n[Put](${url})`
    );
  });

  it('titles a URL put from a named register', async function () {
    await openVimNote(`first\n${url}\nlast`);
    await vim('g', 'g', 'j', '"', 'a', 'y', 'y', 'G', '"', 'a', 'p');
    expect(await editorValue()).toBe(`first\n${url}\nlast\n[Put](${url})`);
  });

  it('titles a URL put charwise onto an empty line', async function () {
    await openVimNote(`${url}\n`);
    await vim('g', 'g', '0', 'y', '$', 'G', 'p');
    expect(await editorValue()).toBe(`${url}\n[Put](${url})`);
  });

  it('titles a URL put over a visual selection', async function () {
    await openVimNote(`${url}\nword`);
    await vim('g', 'g', '0', 'y', '$', 'G', '0', 'v', 'e', 'p');
    expect(await editorValue()).toBe(`${url}\n[Put](${url})`);
  });

  it('gives back the URL with one undo, and removes the put with another', async function () {
    await openVimNote(`first\n${url}\nlast`);
    await vim('g', 'g', 'j', 'y', 'y', 'G', 'p');
    expect(await editorValue()).toBe(`first\n${url}\nlast\n[Put](${url})`);
    await vim('u');
    expect(await editorValue()).toBe(`first\n${url}\nlast\n${url}`);
    await vim('u');
    expect(await editorValue()).toBe(`first\n${url}\nlast`);
  });

  describe('left as vim put it', function () {
    it('when the register holds text other than URLs', async function () {
      await openVimNote(`some words\n${url}`);
      await vim('g', 'g', 'y', 'y', 'G', 'p');
      expect(await editorValue()).toBe(`some words\n${url}\nsome words`);
      expect(requestLog()).toEqual([]);
    });

    it('when a count runs copies of a URL together', async function () {
      await openVimNote(`${url}\n`);
      await vim('g', 'g', '0', 'y', '$', 'G', '3', 'p');
      expect(await editorValue()).toBe(`${url}\n${url}${url}${url}`);
      expect(requestLog()).toEqual([]);
    });

    it('when the put lands in a code block', async function () {
      await openVimNote(`${url}\n\`\`\`\ncode\n\`\`\``);
      await vim('g', 'g', 'y', 'y', 'j', 'p');
      expect(await editorValue()).toBe(`${url}\n\`\`\`\n${url}\ncode\n\`\`\``);
      expect(requestLog()).toEqual([]);
    });

    it('when titling pasted URLs is off', async function () {
      await setSettings({ enhancePaste: false });
      await openVimNote(`first\n${url}\nlast`);
      await vim('g', 'g', 'j', 'y', 'y', 'G', 'p');
      expect(await editorValue()).toBe(`first\n${url}\nlast\n${url}`);
      expect(requestLog()).toEqual([]);
    });

    it('when vim mode is off', async function () {
      await setVimMode(false);
      await openVimNote(`first\n${url}\nlast`);
      await browser.keys(['p']);
      await settled();
      expect(await editorValue()).toBe(`first\n${url}\nlastp`);
      expect(requestLog()).toEqual([]);
    });
  });
});
