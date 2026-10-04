import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  clearNotices,
  editorText,
  editorValue,
  notices,
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

describe('Pasting a URL', function () {
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

  it('inserts a markdown link titled with the page title', async function () {
    await openNote('See ‸ for details.');
    const url = `${base}/page?title=Fixture`;
    await paste(url);
    await settled();
    expect(await editorText()).toBe(`See [Fixture](${url})‸ for details.`);
  });

  it('shows a placeholder until the title arrives', async function () {
    await openNote('‸');
    const url = `${base}/slow?ms=1500&title=Late`;
    await paste(url);
    expect(await editorValue()).toMatch(
      /^\[Fetching title…[\u200b\u200c]{32}\]\(http:\/\/127\.0\.0\.1:\d+\/slow\?ms=1500&title=Late\)$/
    );
    await settled();
    expect(await editorValue()).toBe(`[Late](${url})`);
  });

  it('escapes markdown in the title', async function () {
    await openNote('‸');
    const url = `${base}/markdown`;
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(
      `[A \\*bold\\* \\[claim\\] \\| with \\\`code\\\` & \\$5](${url})`
    );
  });

  it('joins a title that spans lines with a space', async function () {
    await openNote('‸');
    await paste(`${base}/multiline`);
    await settled();
    expect(await editorValue()).toBe(
      `[First line second line](${base}/multiline)`
    );
  });

  it('writes the title in the right place far along a later line', async function () {
    // Upstream's offset-to-position helper mis-measured any line but the
    // first, so the title landed in the wrong spot once the paste was far
    // enough along its line.
    const lead = 'x'.repeat(60);
    await openNote(`first line\nsecond line\n${lead} ‸ tail`);
    const url = `${base}/page?title=Placed`;
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(
      `first line\nsecond line\n${lead} [Placed](${url}) tail`
    );
  });

  it("doesn't overwrite a URL it is pasted next to", async function () {
    // Upstream expanded an empty selection to the URL around the cursor
    // before pasting, replacing that URL with the new link.
    const existing = `${base}/page?title=Existing`;
    await openNote(`${existing}‸`);
    const url = `${base}/page?title=New`;
    await paste(` ${url}`);
    await settled();
    expect(await editorValue()).toBe(`${existing} [New](${url})`);
  });

  it('titles a normal paste straight after a plain one', async function () {
    await openNote('‸');
    await paste(`${base}/page?title=Plain`, { plain: true });
    const url = `${base}/page?title=Titled`;
    await paste(` ${url}`);
    await settled();
    expect(await editorValue()).toBe(
      `${base}/page?title=Plain [Titled](${url})`
    );
  });

  it('titles several URLs pasted at once', async function () {
    await openNote('‸');
    const a = `${base}/page?title=One`;
    const b = `${base}/page?title=Two`;
    await paste(`${a}\n${b}`);
    await settled();
    expect(await editorValue()).toBe(`[One](${a})\n[Two](${b})`);
  });

  it('unwraps a pasted <URL> autolink', async function () {
    await openNote('‸');
    const url = `${base}/page?title=Angled`;
    await paste(`<${url}>`);
    await settled();
    expect(await editorValue()).toBe(`[Angled](${url})`);
  });

  it('follows redirects', async function () {
    await openNote('‸');
    await paste(`${base}/redirect`);
    await settled();
    expect(await editorValue()).toBe(`[Redirected](${base}/redirect)`);
  });

  it('decodes a page in a legacy encoding', async function () {
    await openNote('‸');
    await paste(`${base}/gbk`);
    await settled();
    expect(await editorValue()).toBe(`[中文标题](${base}/gbk)`);
  });

  it('falls back to og:title', async function () {
    await openNote('‸');
    await paste(`${base}/og`);
    await settled();
    expect(await editorValue()).toBe(`[Open Graph title](${base}/og)`);
  });

  it('names a file by its path without downloading it', async function () {
    await openNote('‸');
    await paste(`${base}/download`);
    await settled();
    expect(await editorValue()).toBe(`[download](${base}/download)`);
    expect(requestLog().map((r) => r.method)).toEqual(['HEAD']);
  });

  it('shortens the title to the maximum length', async function () {
    await setSettings({ maxTitleLength: 5 });
    await openNote('‸');
    const url = `${base}/page?title=Abcdefghij`;
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(`[Abcde…](${url})`);
  });

  describe('when no title can be found', function () {
    for (const [what, path] of [
      ['the site answers 404', '/missing'],
      ['the page has no title', '/notitle'],
      ['the page is a bot challenge', '/challenge'],
    ]) {
      it(`leaves the URL as pasted when ${what}`, async function () {
        await openNote('a ‸ b');
        await paste(`${base}${path}`);
        await settled();
        expect(await editorValue()).toBe(`a ${base}${path} b`);
        expect((await notices()).join('\n')).toContain(
          "Couldn't find a title for 127.0.0.1."
        );
      });
    }

    it('gives up after the timeout instead of leaving a placeholder', async function () {
      await browser.executeObsidian(({ app }) => {
        (app as any).plugins.plugins['named-links'].requestTimeoutMs = 500;
      });
      await openNote('‸');
      const url = `${base}/slow`;
      await paste(url);
      await settled();
      expect(await editorValue()).toBe(url);
    });
  });

  it('finishes the link in the file after switching notes', async function () {
    await openNote('‸', { name: 'First.md' });
    const url = `${base}/slow?ms=1500&title=Background`;
    await paste(url);
    // The same tab moves on to another note, so the editor that took the
    // paste no longer shows the note the placeholder is in.
    await obsidianPage.write('Second.md', 'other');
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath('Second.md')!;
      await app.workspace.getLeaf(false).openFile(file);
    });
    await settled();
    expect(await obsidianPage.read('First.md')).toBe(`[Background](${url})`);
    expect(await obsidianPage.read('Second.md')).toBe('other');
  });

  describe('left as pasted', function () {
    it('when the text is not only URLs', async function () {
      await openNote('‸');
      await paste(`read ${base}/page`);
      expect(await editorValue()).toBe(`read ${base}/page`);
    });

    it('when the URL is an image', async function () {
      await openNote('‸');
      await paste(`${base}/cat.png`);
      expect(await editorValue()).toBe(`${base}/cat.png`);
      expect(requestLog()).toEqual([]);
    });

    it('when pasted as plain text with Mod+Shift+V', async function () {
      await openNote('‸');
      await paste(`${base}/page`, { plain: true });
      expect(await editorValue()).toBe(`${base}/page`);
      expect(requestLog()).toEqual([]);
    });

    it('when pasting is turned off', async function () {
      await setSettings({ enhancePaste: false });
      await openNote('‸');
      await paste(`${base}/page`);
      expect(await editorValue()).toBe(`${base}/page`);
      expect(requestLog()).toEqual([]);
    });

    for (const [where, fixture] of [
      ['into a link target', '[text](‸)'],
      ['into an HTML attribute', '<a href="‸">'],
      ['into a fenced code block', '```\n‸\n```'],
      ['into inline code', 'run `curl ‸`'],
      ['into frontmatter', '---\nsource: ‸\n---\n'],
    ]) {
      it(`when pasted ${where}`, async function () {
        await openNote(fixture, { source: true });
        await paste(`${base}/page`);
        expect(await editorValue()).toBe(fixture.replace('‸', `${base}/page`));
        expect(requestLog()).toEqual([]);
      });
    }

    it('still skips code where the removed setting was saved as off', async function () {
      // "Skip code and frontmatter" used to be a setting. A vault that had
      // turned it off keeps the key in data.json, and it has to be ignored.
      await browser.executeObsidian(async ({ app }) => {
        const p = (app as any).plugins.plugins['named-links'];
        await p.saveData({ ...p.settings, skipCodeAndFrontmatter: false });
        await p.loadSettings();
      });
      await openNote('```\n‸\n```', { source: true });
      await paste(`${base}/page`);
      expect(await editorValue()).toBe(`\`\`\`\n${base}/page\n\`\`\``);
      expect(requestLog()).toEqual([]);
    });
  });

  // Real keystrokes through WebDriver, with the URL on the real clipboard,
  // rather than synthetic events: what Obsidian does with each shortcut is
  // the thing under test.
  describe('with real keystrokes', function () {
    async function pressWithClipboard(text: string, keys: string[]) {
      await browser.executeObsidian(async (_, text) => {
        await navigator.clipboard.writeText(text);
      }, text);
      await browser.keys(keys);
      await browser.pause(300);
      await settled();
    }

    it('titles a URL pasted with Ctrl+V', async function () {
      await openNote('‸');
      const url = `${base}/page?title=Keyed`;
      await pressWithClipboard(url, ['Control', 'v']);
      expect(await editorValue()).toBe(`[Keyed](${url})`);
    });

    it('leaves every paste from Ctrl+Shift+V alone', async function () {
      // Obsidian fires two paste events for one Ctrl+Shift+V; neither may be
      // titled, whatever Obsidian itself inserts for them.
      await openNote('‸');
      await pressWithClipboard(`${base}/page`, ['Control', 'Shift', 'v']);
      expect(await editorValue()).not.toContain('](');
      expect(requestLog()).toEqual([]);
    });
  });

  describe('over a selection', function () {
    it('replaces the selection with the titled link when set to', async function () {
      await setSettings({ useSelectionAsTitle: false });
      await openNote('see «this» now');
      const url = `${base}/page?title=Fetched`;
      await paste(url);
      await settled();
      expect(await editorValue()).toBe(`see [Fetched](${url}) now`);
    });

    it('links the selected text by default', async function () {
      await openNote('see «this text» now');
      const url = `${base}/page`;
      await paste(url);
      await settled();
      expect(await editorValue()).toBe(`see [this text](${url}) now`);
      expect(requestLog()).toEqual([]);
    });
  });

  describe('excluded sites', function () {
    it('are pasted as they are without being fetched', async function () {
      await setSettings({ excludedSites: 'example.org\n127.0.0.1' });
      await openNote('‸');
      await paste(`${base}/page`);
      expect(await editorValue()).toBe(`${base}/page`);
      expect(requestLog()).toEqual([]);
    });

    it('are linked under their domain when set to', async function () {
      await setSettings({
        excludedSites: '127.0.0.1',
        excludedSiteFormat: 'domain',
      });
      await openNote('‸');
      await paste(`${base}/page`);
      await settled();
      expect(await editorValue()).toBe(`[127.0.0.1](${base}/page)`);
      expect(requestLog()).toEqual([]);
    });
  });
});
