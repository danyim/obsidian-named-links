import { browser, expect } from '@wdio/globals';

import {
  editorValue,
  openNote,
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

/** Extra clipboard formats to send along with the plain text. */
type Formats = Record<string, string>;

/**
 * A paste whose clipboard carries `formats` besides `text/plain`, the way a
 * link copied from a browser arrives.
 */
async function pasteWith(text: string, formats: Formats): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, text, formats) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      const content = (view.editor as any).cm.contentDOM as HTMLElement;
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'v',
          code: 'KeyV',
          ctrlKey: true,
          bubbles: true,
        })
      );
      const data = new DataTransfer();
      data.setData('text/plain', text);
      for (const [type, value] of Object.entries(formats)) {
        data.setData(type, value);
      }
      content.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    text,
    formats
  );
}

/** A drop at the end of the note carrying `formats` besides `text/plain`. */
async function dropWith(text: string, formats: Formats): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, text, formats) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      const cm = (view.editor as any).cm;
      const coords = cm.coordsAtPos(cm.state.doc.length);
      const data = new DataTransfer();
      data.setData('text/plain', text);
      for (const [type, value] of Object.entries(formats)) {
        data.setData(type, value);
      }
      cm.contentDOM.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: data,
          clientX: coords.left + 1,
          clientY: (coords.top + coords.bottom) / 2,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    text,
    formats
  );
}

/** Edge's Copy link, and a link dragged out of a page, carry this shape. */
function anchorHtml(url: string, text: string): string {
  const href = url.replace(/&/g, '&amp;');
  return `<html><body><!--StartFragment--><a href="${href}">${text}</a><!--EndFragment--></body></html>`;
}

describe('Using the title a link was copied with', function () {
  let base: string;

  before(async function () {
    base = await fixtureBase();
  });

  after(async function () {
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
    clearRequestLog();
  });

  it('uses the link text copied with the URL, without a request', async function () {
    const url = `${base}/page?title=Fetched`;
    await openNote('‸');
    await pasteWith(url, { 'text/html': anchorHtml(url, 'Copied title') });
    // No settled(): the link is finished as soon as the paste is.
    expect(await editorValue()).toBe(`[Copied title](${url})`);
    await settled();
    expect(requestLog()).toEqual([]);
  });

  it("keeps the copied title and fills the format's other page fields", async function () {
    // The copied text is the title; the page is read only for {author}.
    await setSettings({
      linkFormat: 'custom',
      customLinkFormat: '[{title} by {author}]({url})',
    });
    const url = `${base}/about`;
    await openNote('‸');
    await pasteWith(url, { 'text/html': anchorHtml(url, 'Copied title') });
    await settled();
    expect(await editorValue()).toBe(`[Copied title by Ada Lovelace](${url})`);
  });

  it('escapes a copied title like a fetched one', async function () {
    await setSettings({
      linkFormat: 'custom',
      customLinkFormat: '[{title} by {author}]({url})',
    });
    const url = `${base}/about`;
    await openNote('‸');
    await pasteWith(url, {
      'text/html': anchorHtml(url, 'A [bracketed] title'),
    });
    await settled();
    expect(await editorValue()).toBe(
      `[A \\[bracketed\\] title by Ada Lovelace](${url})`
    );
  });

  it("uses Firefox's title on a dropped link", async function () {
    const url = `${base}/page?title=Fetched`;
    await openNote('Drop: ‸');
    await dropWith(url, { 'text/x-moz-url': `${url}\nFrom Firefox` });
    await settled();
    expect(await editorValue()).toBe(`Drop: [From Firefox](${url})`);
    expect(requestLog()).toEqual([]);
  });

  it('fetches the title when the copied text says nothing', async function () {
    const url = `${base}/page?title=Fetched`;
    await openNote('‸');
    await pasteWith(url, { 'text/html': anchorHtml(url, 'click here') });
    await settled();
    expect(await editorValue()).toBe(`[Fetched](${url})`);
  });

  it('fetches the title when the copied text is the URL', async function () {
    const url = `${base}/page?title=Fetched`;
    await openNote('‸');
    await pasteWith(url, { 'text/html': anchorHtml(url, url) });
    await settled();
    expect(await editorValue()).toBe(`[Fetched](${url})`);
  });

  it('fetches the title when the link was copied with other text', async function () {
    const url = `${base}/page?title=Fetched`;
    await openNote('‸');
    await pasteWith(url, {
      'text/html': `<p>See <a href="${url.replace(/&/g, '&amp;')}">this article</a> for more.</p>`,
    });
    await settled();
    expect(await editorValue()).toBe(`[Fetched](${url})`);
  });

  it('still fetches each title when several URLs are pasted', async function () {
    const a = `${base}/page?title=One`;
    const b = `${base}/page?title=Two`;
    await openNote('‸');
    await pasteWith(`${a}\n${b}`, { 'text/html': anchorHtml(a, 'Copied') });
    await settled();
    expect(await editorValue()).toBe(`[One](${a})\n[Two](${b})`);
  });

  it('runs the copied title through clean-up, length and link format', async function () {
    await setSettings({
      titleRules: '/ \\| Example$/ =>',
      maxTitleLength: 10,
      linkFormat: 'html',
    });
    const url = `${base}/page`;
    await openNote('‸');
    await pasteWith(url, {
      'text/html': anchorHtml(url, 'A long article title | Example'),
    });
    expect(await editorValue()).toBe(`<a href="${url}">A long art…</a>`);
    await settled();
    expect(requestLog()).toEqual([]);
  });

  it('leaves an excluded site to Obsidian, without a request', async function () {
    // The plugin steps aside for an excluded site, so what lands is
    // Obsidian's own paste, which converts copied HTML into a link by
    // itself. Nothing is fetched and no placeholder goes in.
    await setSettings({ excludedSites: '127.0.0.1' });
    const url = `${base}/page`;
    await openNote('‸');
    await pasteWith(url, { 'text/html': anchorHtml(url, 'Copied title') });
    await settled();
    expect(await editorValue()).not.toContain('Fetching');
    expect(requestLog()).toEqual([]);
  });
});
