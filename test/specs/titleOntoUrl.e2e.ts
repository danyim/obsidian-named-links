import { browser, expect } from '@wdio/globals';

import {
  editorText,
  editorValue,
  openNote,
  paste,
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

function undo(): Promise<void> {
  return browser.executeObsidian(({ app, obsidian }) => {
    app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.undo();
  });
}

describe('Pasting text onto a selected URL (#7)', function () {
  let base: string;
  let url: string;

  before(async function () {
    base = await fixtureBase();
    url = `${base}/page?title=Fetched`;
  });

  after(async function () {
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
    // Off by default; every spec here is about what it does when on.
    await setSettings({ pasteTitleOntoUrl: true });
    clearRequestLog();
  });

  /** Pastes `text` and checks that nothing was looked up. */
  async function pasteText(text: string, options: { plain?: boolean } = {}) {
    await paste(text, options);
    await settled();
    expect(requestLog()).toEqual([]);
  }

  it('makes the pasted text the title of a selected URL', async function () {
    await openNote(`see «${url}» now`);
    await pasteText('My page');
    expect(await editorText()).toBe(`see [My page](${url})‸ now`);
  });

  it('takes an autolink whole', async function () {
    await openNote(`see «<${url}>» now`, { source: true });
    await pasteText('My page');
    expect(await editorValue()).toBe(`see [My page](${url}) now`);
  });

  it("replaces a selected link's title", async function () {
    await openNote(`see «[old title](${url})» now`, { source: true });
    await pasteText('New title');
    expect(await editorValue()).toBe(`see [New title](${url}) now`);
  });

  it('writes the link in the chosen link format', async function () {
    await setSettings({ linkFormat: 'html' });
    await openNote(`«${base}/plain»`);
    await pasteText('My page');
    expect(await editorValue()).toBe(`<a href="${base}/plain">My page</a>`);
  });

  it('gives the URL back with one undo', async function () {
    await openNote(`see «${url}» now`);
    await pasteText('My page');
    await undo();
    expect(await editorValue()).toBe(`see ${url} now`);
  });

  describe('left to the ordinary paste', function () {
    it('when a URL is pasted over the URL', async function () {
      // Titled as any pasted URL is, replacing the selection.
      await setSettings({ useSelectionAsTitle: false });
      await openNote(`«${base}/old»`);
      const pasted = `${base}/page?title=Replacement`;
      await paste(pasted);
      await settled();
      expect(await editorValue()).toBe(`[Replacement](${pasted})`);
    });

    it('when the pasted text runs over several lines', async function () {
      await openNote(`«${url}»`);
      await pasteText('one\ntwo');
      expect(await editorValue()).toBe('one\ntwo');
    });

    it('when the selection holds more than the URL', async function () {
      await openNote(`«see ${url}» now`);
      await pasteText('My page');
      expect(await editorValue()).toBe('My page now');
    });

    it('with the default settings, where it is off', async function () {
      await resetPlugin();
      await openNote(`see «${url}» now`);
      await pasteText('My page');
      expect(await editorValue()).toBe('see My page now');
    });

    it('when pasted as plain text with Mod+Shift+V', async function () {
      await openNote(`«${url}»`);
      await pasteText('My page', { plain: true });
      expect(await editorValue()).toBe('My page');
    });

    it('when the URL is in inline code', async function () {
      await openNote(`run \`«${url}»\``, { source: true });
      await pasteText('My page');
      expect(await editorValue()).toBe('run `My page`');
    });

    it("when the link format doesn't show a title", async function () {
      await setSettings({
        linkFormat: 'custom',
        customLinkFormat: '[source]({url})',
      });
      await openNote(`«${url}»`);
      await pasteText('My page');
      expect(await editorValue()).toBe('My page');
    });
  });

  it("doesn't depend on titling pasted URLs being on", async function () {
    await setSettings({ enhancePaste: false });
    await openNote(`«${url}»`);
    await pasteText('My page');
    expect(await editorValue()).toBe(`[My page](${url})`);
  });
});
