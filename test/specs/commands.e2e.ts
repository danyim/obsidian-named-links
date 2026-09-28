import { expect } from '@wdio/globals';

import {
  clearNotices,
  editorText,
  editorValue,
  notices,
  openNote,
  resetPlugin,
  runCommand,
  settled,
  stubClipboard,
} from '../helpers';
import {
  clearRequestLog,
  fixtureBase,
  requestLog,
  stopFixtureServer,
} from '../server';

describe('Commands', function () {
  let base: string;

  before(async function () {
    base = await fixtureBase();
  });

  after(async function () {
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
    await clearNotices();
    clearRequestLog();
  });

  describe('Add a title to an existing URL', function () {
    it('titles a bare URL at the start of a line', async function () {
      // Upstream never matched a URL at column 0.
      const url = `${base}/page?title=First`;
      await openNote(`${url}‸ and more`);
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`[First](${url}) and more`);
    });

    it('titles the URL the cursor is inside', async function () {
      const url = `${base}/page?title=Inside`;
      await openNote(`see ${url.slice(0, 10)}‸${url.slice(10)} ok`);
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`see [Inside](${url}) ok`);
    });

    it("replaces a markdown link's text with the fetched title", async function () {
      const url = `${base}/page?title=Fresh`;
      await openNote(`a [stale‸ text](${url}) b`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`a [Fresh](${url}) b`);
    });

    it('restores a markdown link when no title is found', async function () {
      const url = `${base}/missing`;
      await openNote(`a [kept‸](${url}) b`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`a [kept](${url}) b`);
    });

    it('titles every bare URL in a selection, skipping links and code', async function () {
      const a = `${base}/page?title=A`;
      const b = `${base}/page?title=B`;
      const linked = `[linked](${base}/page?title=No)`;
      const code = `\`${base}/page?title=Code\``;
      await openNote(`«${a}\n${linked} ${code}\n- ${b}»`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(
        `[A](${a})\n${linked} ${code}\n- [B](${b})`
      );
    });

    it('says so when there is no URL at the cursor', async function () {
      await openNote('just words‸');
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe('just words');
      expect(await notices()).toContain(
        'There is no URL here to add a title to.'
      );
    });
  });

  describe('Paste URL and fetch its title', function () {
    it('titles the URL on the clipboard', async function () {
      const url = `${base}/page?title=Clipped`;
      await stubClipboard(url);
      await openNote('x ‸ y');
      await runCommand('paste-url-with-title');
      await settled();
      expect(await editorText()).toBe(`x [Clipped](${url})‸ y`);
    });

    it('pastes other text as it is', async function () {
      await stubClipboard('plain words');
      await openNote('‸');
      await runCommand('paste-url-with-title');
      await settled();
      expect(await editorValue()).toBe('plain words');
    });
  });

  describe('Paste without fetching a title', function () {
    it('pastes the URL as it is', async function () {
      const url = `${base}/page`;
      await stubClipboard(url);
      await openNote('‸');
      await runCommand('paste-without-title');
      await settled();
      expect(await editorValue()).toBe(url);
      expect(requestLog()).toEqual([]);
    });
  });

  it('registers no default hotkeys', async function () {
    // Obsidian's guidelines ask plugins not to; upstream's Mod+Shift+V
    // default broke plain-text paste on non-Latin layouts (upstream #170).
    const { browser } = await import('@wdio/globals');
    const hotkeys = await browser.executeObsidian(({ app }) => {
      const commands = (app as any).commands.commands;
      return Object.keys(commands)
        .filter((id) => id.startsWith('named-links:'))
        .flatMap((id) => commands[id].hotkeys ?? []);
    });
    expect(hotkeys).toEqual([]);
  });
});
