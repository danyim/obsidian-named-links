import { browser, expect } from '@wdio/globals';

import {
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

/** Pastes `url` into an empty note and returns what the note holds after. */
async function pasteInto(url: string): Promise<string> {
  await openNote('‸');
  await paste(url);
  await settled();
  return editorValue();
}

function custom(customLinkFormat: string) {
  return setSettings({ linkFormat: 'custom', customLinkFormat });
}

/** Today, as Obsidian's own moment formats it. */
function today(format: string): Promise<string> {
  return browser.executeObsidian(
    ({ obsidian }, format) => obsidian.moment().format(format),
    format
  );
}

describe('Link format placeholders from the page', function () {
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

  it('fills in the author, site and description', async function () {
    await custom('[{title} by {author} on {site}]({url} "{description}")');
    const url = `${base}/about`;
    expect(await pasteInto(url)).toBe(
      `[About page by Ada Lovelace on Fixture Site](${url} "What this page is about")`
    );
  });

  it("fills in the section a URL's fragment points to", async function () {
    await custom('[{title} › {section}]({url})');
    const url = `${base}/about#usage`;
    expect(await pasteInto(url)).toBe(`[About page › Usage](${url})`);
  });

  it('matches a section by its heading text (upstream #130)', async function () {
    await custom('[{section}]({url})');
    const url = `${base}/about#Link+to+a+heading+in+a+note`;
    expect(await pasteInto(url)).toBe(`[Link to a heading in a note](${url})`);
  });

  it('leaves out a missing author and the separator before it', async function () {
    await custom('[{title} - {author}]({url})');
    const url = `${base}/about?bare=1`;
    expect(await pasteInto(url)).toBe(`[About page](${url})`);
  });

  it('reads the author from oEmbed (upstream #15, #34)', async function () {
    await browser.executeObsidian(({ app }, base) => {
      (app as any).plugins.plugins['named-links'].oEmbedProviders = [
        { pattern: /\/video$/, endpoint: `${base}/oembed` },
      ];
    }, base);
    await custom('[{title} ({author})]({url})');
    const url = `${base}/video`;
    expect(await pasteInto(url)).toBe(`[A video (A Channel)](${url})`);
    expect(requestLog().some((r) => r.path.startsWith('/oembed'))).toBe(true);
  });

  it('writes the date without fetching anything (upstream #86)', async function () {
    await custom('[source]({url}) {date} {date:YYYY}');
    const url = `${base}/about`;
    await openNote('‸');
    await paste(url);
    // No settled(): with nothing to fetch the link goes in at once.
    expect(await editorValue()).toBe(
      `[source](${url}) ${await today('YYYY-MM-DD')} ${await today('YYYY')}`
    );
    await settled();
    expect(requestLog()).toEqual([]);
  });

  it('dates a fetched link too', async function () {
    await custom('[{title}]({url}) (read {date:D MMM YYYY})');
    const url = `${base}/about`;
    expect(await pasteInto(url)).toBe(
      `[About page](${url}) (read ${await today('D MMM YYYY')})`
    );
  });
});
