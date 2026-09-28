import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  clearNotices,
  drop,
  editorValue,
  notices,
  openNote,
  paste,
  resetPlugin,
  runCommand,
  setSettings,
  settled,
} from '../helpers';
import {
  clearRequestLog,
  fixtureBase,
  requestLog,
  stopFixtureServer,
} from '../server';

describe('Editing around a title lookup', function () {
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

  it('titles a URL with nested parentheses', async function () {
    const url = `${base}/page?title=Nested&x=A_(b_(c))`;
    await openNote('‸');
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(`[Nested](<${url}>)`);
  });

  it('finishes the link in the file when its tab is closed', async function () {
    await openNote('‸', { name: 'Closed.md' });
    const url = `${base}/slow?ms=1500&title=Closed`;
    await paste(url);
    await browser.executeObsidian(async ({ app }) => {
      // Let the placeholder reach the file, as closing the tab would.
      const leaf = app.workspace.getMostRecentLeaf()!;
      await (leaf.view as any).save();
      leaf.detach();
    });
    await settled();
    expect(await obsidianPage.read('Closed.md')).toBe(`[Closed](${url})`);
  });

  it("doesn't bring back a placeholder the user removed", async function () {
    await openNote('‸', { name: 'Removed.md' });
    await paste(`${base}/slow?ms=1500&title=Unwanted`);
    await browser.executeObsidian(async ({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      // On disk with the placeholder, then removed in the editor.
      await view.save();
      view.editor.setValue('kept');
    });
    await settled();
    expect(await editorValue()).toBe('kept');
  });

  it('leaves a multi-cursor paste to Obsidian', async function () {
    await openNote('a\nb');
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView
      )!.editor;
      editor.setSelections([
        { anchor: { line: 0, ch: 1 } },
        { anchor: { line: 1, ch: 1 } },
      ]);
    });
    await paste(`${base}/page`);
    await settled();
    expect(await editorValue()).not.toContain('Fetching title');
    expect(requestLog()).toEqual([]);
  });

  it('leaves a URL pasted into a reference definition as it is', async function () {
    await openNote('[1]: ‸', { source: true });
    await paste(`${base}/page`);
    expect(await editorValue()).toBe(`[1]: ${base}/page`);
    expect(requestLog()).toEqual([]);
  });

  it('escapes unpaired brackets in a selection used as the title', async function () {
    await setSettings({ useSelectionAsTitle: true });
    await openNote('«see [1»');
    await paste(`${base}/page`);
    expect(await editorValue()).toBe(`[see \\[1](${base}/page)`);
  });

  it('handles an outside drop after an in-app drag ended without dragend', async function () {
    await openNote('Target: ‸');
    await browser.executeObsidian(() => {
      document.body.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true })
      );
    });
    // The in-app drag's drop, with its dragend lost.
    await drop('some text', 'Target: '.length);
    await openNote('Target: ‸');
    const url = `${base}/page?title=Outside`;
    await drop(url, 'Target: '.length);
    await settled();
    expect(await editorValue()).toBe(`Target: [Outside](${url})`);
  });

  describe('Add a title to an existing URL', function () {
    it('turns an autolink into a titled link', async function () {
      const url = `${base}/page?title=Auto`;
      await openNote(`see <${url}‸> now`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`see [Auto](${url}) now`);
    });

    for (const [what, text] of [
      ['an image embed', '![](URL?id=5)'],
      ['a reference definition', '[ref]: URL'],
      ['a link with a title', '[t](URL "Title")'],
    ]) {
      it(`leaves ${what} alone`, async function () {
        const line = text.replace('URL', `${base}/page`);
        await openNote(`${line.slice(0, -2)}‸${line.slice(-2)}`, {
          source: true,
        });
        await runCommand('enhance-url-with-title');
        await settled();
        expect(await editorValue()).toBe(line);
        expect(await notices()).toContain(
          'There is no URL here to add a title to.'
        );
      });
    }

    it('titles the whole URL when the selection ends partway through it', async function () {
      const url = `${base}/page?title=Whole`;
      await openNote(`«see ${url.slice(0, 12)}»${url.slice(12)} end`);
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`see [Whole](${url}) end`);
    });

    it('skips frontmatter in a selection', async function () {
      const a = `${base}/page?title=Body`;
      const fm = `---\nsource: ${base}/page?title=Meta\n---\n`;
      await openNote(`«${fm}${a}»`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`${fm}[Body](${a})`);
    });
  });
});
