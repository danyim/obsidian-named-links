import assert from 'node:assert/strict';

import {
  HttpRequest,
  HttpResponse,
  decodeHtml,
  extractPageInfo,
  extractSection,
  extractSiteName,
  extractTitle,
  fetchPageInfo,
  fetchTitle,
  twitterProxyUrl,
} from '../../src/scraper';

type Route = (req: HttpRequest) => Partial<HttpResponse> & {
  bytes?: Uint8Array;
  html?: string;
};

/** A fake HTTP client that records every request it is asked to make. */
function fakeHttp(route: Route) {
  const requests: HttpRequest[] = [];
  const http = async (req: HttpRequest): Promise<HttpResponse> => {
    requests.push(req);
    const res = route(req);
    const bytes = res.bytes ?? new TextEncoder().encode(res.html ?? '');
    return {
      status: res.status ?? 200,
      headers: res.headers ?? { 'content-type': 'text/html; charset=utf-8' },
      body: () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer,
    };
  };
  return { http, requests };
}

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body></body></html>`;

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

function concat(...parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === 'string' ? new TextEncoder().encode(p) : p
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('extractPageInfo', () => {
  const head = (meta: string) =>
    `<html><head><title>T</title>${meta}</head><body></body></html>`;

  it('has no info for a page without a title', () => {
    assert.equal(extractPageInfo('<html><body>hi</body></html>'), null);
  });

  it('reads the author from the author meta tag', () => {
    assert.equal(
      extractPageInfo(head('<meta name="author" content="Ada">'))?.author,
      'Ada'
    );
  });

  it("reads article:author, but not when it's a profile URL", () => {
    assert.equal(
      extractPageInfo(head('<meta property="article:author" content="Ada">'))
        ?.author,
      'Ada'
    );
    assert.equal(
      extractPageInfo(
        head(
          '<meta property="article:author" content="https://example.com/ada">'
        )
      )?.author,
      null
    );
  });

  it('prefers the Open Graph description, then the standard one', () => {
    assert.equal(
      extractPageInfo(
        head(
          '<meta name="description" content="Plain"><meta property="og:description" content="OG">'
        )
      )?.description,
      'OG'
    );
    assert.equal(
      extractPageInfo(head('<meta name="description" content="Plain">'))
        ?.description,
      'Plain'
    );
    assert.equal(
      extractPageInfo(head('<meta name="twitter:description" content="Card">'))
        ?.description,
      'Card'
    );
  });

  it('leaves out what the page is silent about', () => {
    assert.deepEqual(extractPageInfo(head('')), {
      title: 'T',
      siteName: null,
      author: null,
      description: null,
      section: null,
    });
  });
});

describe('extractSection', () => {
  const body = (html: string) => `<html><body>${html}</body></html>`;

  it('reads the heading with the id', () => {
    assert.equal(
      extractSection(body('<h2 id="install">Install</h2>'), 'install'),
      'Install'
    );
  });

  it('reads the heading an anchor sits in, holds, or comes before', () => {
    assert.equal(
      extractSection(body('<h3><a id="a"></a>Inside</h3>'), 'a'),
      'Inside'
    );
    assert.equal(
      extractSection(
        body('<section id="s"><h2>Held</h2><p>x</p></section>'),
        's'
      ),
      'Held'
    );
    assert.equal(
      extractSection(body('<a name="old"></a><h2>After</h2>'), 'old'),
      'After'
    );
  });

  it('matches a percent-encoded fragment', () => {
    assert.equal(
      extractSection(body('<h2 id="über">Über</h2>'), '%C3%BCber'),
      'Über'
    );
  });

  it('matches heading text when headings carry no id (upstream #130)', () => {
    assert.equal(
      extractSection(
        body('<h2>Link to a heading in a note</h2>'),
        'Link+to+a+heading+in+a+note'
      ),
      'Link to a heading in a note'
    );
  });

  it('drops permalink marks around the heading text', () => {
    assert.equal(
      extractSection(body('<h2 id="x"># Setup ¶</h2>'), 'x'),
      'Setup'
    );
  });

  it('has nothing for a missing target or a long non-heading one', () => {
    assert.equal(extractSection(body('<h2 id="a">A</h2>'), 'b'), null);
    assert.equal(
      extractSection(body(`<div id="d">${'word '.repeat(60)}</div>`), 'd'),
      null
    );
    assert.equal(extractSection(body('<h2 id="a">A</h2>'), ''), null);
  });
});

describe('extractTitle', () => {
  it('reads <title>', () => {
    assert.equal(extractTitle(page('Hello &amp; welcome')), 'Hello & welcome');
  });

  it('falls back to og:title, then twitter:title', () => {
    assert.equal(
      extractTitle(
        '<html><head><title> </title><meta property="og:title" content="OG"></head></html>'
      ),
      'OG'
    );
    assert.equal(
      extractTitle(
        '<html><head><meta name="twitter:title" content="Card"></head></html>'
      ),
      'Card'
    );
  });

  it("skips an inline SVG's <title>", () => {
    assert.equal(
      extractTitle('<html><body><svg><title>Icon</title></svg></body></html>'),
      null
    );
  });

  it('rejects a bot-challenge interstitial', () => {
    assert.equal(extractTitle(page('Just a moment...')), null);
  });

  it('prefers Open Graph when asked', () => {
    assert.equal(
      extractTitle(
        '<html><head><title>FxTwitter</title><meta property="og:title" content="Someone (@someone)"></head></html>',
        true
      ),
      'Someone (@someone)'
    );
  });
});

describe('extractSiteName', () => {
  it('reads og:site_name, then application-name', () => {
    assert.equal(
      extractSiteName(
        '<head><meta property="og:site_name" content="The Site"><meta name="application-name" content="App"></head>'
      ),
      'The Site'
    );
    assert.equal(
      extractSiteName(
        '<head><meta name="application-name" content="App"></head>'
      ),
      'App'
    );
    assert.equal(extractSiteName(page('x')), null);
  });
});

describe('decodeHtml', () => {
  const gbkTitle = hex('d6d0cec4b1eacce2'); // 中文标题

  it('uses the charset from the Content-Type header (upstream #133)', () => {
    const body = concat('<title>', gbkTitle, '</title>');
    assert.equal(
      extractTitle(
        decodeHtml(body.buffer as ArrayBuffer, 'text/html; charset=GBK')
      ),
      '中文标题'
    );
  });

  it('uses a <meta charset> when the header has none', () => {
    const body = concat(
      '<head><meta charset="gbk"><title>',
      gbkTitle,
      '</title>'
    );
    assert.equal(
      extractTitle(decodeHtml(body.buffer as ArrayBuffer, 'text/html')),
      '中文标题'
    );
  });

  it('uses an http-equiv charset declaration', () => {
    const body = concat(
      '<meta http-equiv="Content-Type" content="text/html; charset=windows-1251"><title>',
      hex('cff0e8e2e5f2'),
      '</title>'
    );
    assert.equal(
      extractTitle(decodeHtml(body.buffer as ArrayBuffer, undefined)),
      'Привет'
    );
  });

  it('falls back to UTF-8 for an unknown charset', () => {
    const body = new TextEncoder().encode('<title>Café</title>');
    assert.equal(
      extractTitle(decodeHtml(body.buffer, 'text/html; charset=bogus')),
      'Café'
    );
  });
});

describe('fetchTitle', () => {
  it('names a file URL without making any request', async () => {
    const { http, requests } = fakeHttp(() => ({}));
    assert.equal(
      await fetchTitle('https://example.com/files/report.pdf', { http }),
      'report.pdf'
    );
    assert.equal(requests.length, 0);
  });

  it('names a non-HTML response by its path after a HEAD', async () => {
    const { http, requests } = fakeHttp(() => ({
      headers: { 'Content-Type': 'video/mp4' },
    }));
    assert.equal(
      await fetchTitle('https://example.com/stream/clip', { http }),
      'clip'
    );
    assert.deepEqual(
      requests.map((r) => r.method),
      ['HEAD']
    );
  });

  it('fetches the page after a HEAD that says HTML', async () => {
    const { http, requests } = fakeHttp(() => ({ html: page('The page') }));
    assert.equal(await fetchTitle('https://example.com', { http }), 'The page');
    assert.deepEqual(
      requests.map((r) => r.method),
      ['HEAD', 'GET']
    );
  });

  it('falls through to GET when HEAD is refused', async () => {
    const { http } = fakeHttp((req) =>
      req.method === 'HEAD' ? { status: 405 } : { html: page('Still here') }
    );
    assert.equal(
      await fetchTitle('https://example.com', { http }),
      'Still here'
    );
  });

  it('sends a browser user agent and the language', async () => {
    const { http, requests } = fakeHttp(() => ({ html: page('x') }));
    await fetchTitle('https://example.com', { http, language: 'ja' });
    assert.match(requests[1].headers['User-Agent'], /Mozilla/);
    assert.equal(requests[1].headers['Accept-Language'], 'ja');
  });

  it('returns null on an error status', async () => {
    const { http } = fakeHttp(() => ({ status: 404, html: page('Not Found') }));
    assert.equal(await fetchTitle('https://example.com/gone', { http }), null);
  });

  it('returns null when the request fails', async () => {
    const http = () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'));
    assert.equal(await fetchTitle('https://nowhere.invalid', { http }), null);
  });

  it('returns null for a page with no title', async () => {
    const { http } = fakeHttp(() => ({ html: '<html><body>hi</body></html>' }));
    assert.equal(await fetchTitle('https://example.com', { http }), null);
  });

  it('asks YouTube over oEmbed', async () => {
    const { http, requests } = fakeHttp((req) =>
      req.url.startsWith('https://www.youtube.com/oembed')
        ? {
            headers: { 'content-type': 'application/json' },
            html: JSON.stringify({ title: 'A video' }),
          }
        : { html: page('- YouTube') }
    );
    assert.equal(
      await fetchTitle('https://youtu.be/dQw4w9WgXcQ', { http }),
      'A video'
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /url=https%3A%2F%2Fyoutu\.be%2FdQw4w9WgXcQ/);
  });

  it('reports what the page says about itself', async () => {
    const { http } = fakeHttp(() => ({
      html: `<head><title>A - Site</title>
        <meta property="og:site_name" content="Site">
        <meta name="author" content="Ada Lovelace">
        <meta property="og:description" content="  About
          the page ">
        </head><body><h2 id="usage">Usage ¶</h2></body>`,
    }));
    assert.deepEqual(
      await fetchPageInfo('https://example.com/docs#usage', { http }),
      {
        title: 'A - Site',
        siteName: 'Site',
        author: 'Ada Lovelace',
        description: 'About the page',
        section: 'Usage',
      }
    );
  });

  it("reports an oEmbed provider's name, author and description", async () => {
    const { http } = fakeHttp(() => ({
      headers: { 'content-type': 'application/json' },
      html: JSON.stringify({
        title: 'A video',
        provider_name: 'YouTube',
        author_name: 'A Channel',
        description: 'What it is',
      }),
    }));
    assert.deepEqual(await fetchPageInfo('https://youtu.be/x', { http }), {
      title: 'A video',
      siteName: 'YouTube',
      author: 'A Channel',
      description: 'What it is',
      section: null,
    });
  });

  it('uses oEmbed providers passed in place of the built-in ones', async () => {
    const { http, requests } = fakeHttp(() => ({
      headers: { 'content-type': 'application/json' },
      html: JSON.stringify({ title: 'Local video' }),
    }));
    const info = await fetchPageInfo('http://127.0.0.1:1/video', {
      http,
      oEmbedProviders: [
        { pattern: /\/video$/, endpoint: 'http://127.0.0.1:1/oembed' },
      ],
    });
    assert.equal(info?.title, 'Local video');
    assert.match(requests[0].url, /^http:\/\/127\.0\.0\.1:1\/oembed\?/);
  });

  it('names a file but knows nothing else about it', async () => {
    const { http } = fakeHttp(() => ({}));
    assert.deepEqual(
      await fetchPageInfo('https://example.com/report.pdf', { http }),
      {
        title: 'report.pdf',
        siteName: null,
        author: null,
        description: null,
        section: null,
      }
    );
  });

  it('falls back to the page when oEmbed fails', async () => {
    const { http } = fakeHttp((req) =>
      req.url.includes('/oembed') ? { status: 401 } : { html: page('Private') }
    );
    assert.equal(
      await fetchTitle('https://www.youtube.com/watch?v=x', { http }),
      'Private'
    );
  });

  describe('X through FxTwitter', () => {
    const url = 'https://x.com/someone/status/1';

    it('maps the hosts', () => {
      assert.equal(twitterProxyUrl(url), 'https://fixupx.com/someone/status/1');
      assert.equal(
        twitterProxyUrl('https://twitter.com/a/status/2'),
        'https://fxtwitter.com/a/status/2'
      );
      assert.equal(twitterProxyUrl('https://example.com'), null);
    });

    it('is used only when turned on', async () => {
      const { http, requests } = fakeHttp(() => ({
        html: '<html><head><title>FxTwitter</title><meta property="og:title" content="Someone (@someone)"></head></html>',
      }));
      assert.equal(
        await fetchTitle(url, { http, twitterProxy: true }),
        'Someone (@someone)'
      );
      assert.deepEqual(
        requests.map((r) => r.url),
        ['https://fixupx.com/someone/status/1']
      );
      assert.match(requests[0].headers['User-Agent'], /LinkPreview/);

      const off = fakeHttp(() => ({ html: page('X') }));
      await fetchTitle(url, { http: off.http });
      assert.equal(
        off.requests.every((r) => r.url === url),
        true
      );
    });
  });
});

describe('fetchPageInfo after oEmbed', () => {
  const provider = {
    pattern: /\/video$/,
    endpoint: 'https://oembed.example/oembed',
  };
  const url = 'https://video.example/video';
  const route = (req: HttpRequest) =>
    req.url.startsWith(provider.endpoint)
      ? {
          headers: { 'content-type': 'application/json' },
          html: JSON.stringify({ title: 'A video', author_name: 'A Channel' }),
        }
      : {
          html: '<html><head><title>Video site</title><meta property="og:description" content="About it"><meta name="author" content="Page author"></head></html>',
        };

  it('stops at oEmbed when the format needs nothing it left out', async () => {
    const { http, requests } = fakeHttp(route);
    const info = await fetchPageInfo(url, {
      http,
      oEmbedProviders: [provider],
      fields: ['author'],
    });
    assert.equal(info?.title, 'A video');
    assert.equal(info?.author, 'A Channel');
    assert.equal(requests.length, 1);
  });

  it("reads the page for a field oEmbed left out, keeping oEmbed's values", async () => {
    const { http, requests } = fakeHttp(route);
    const info = await fetchPageInfo(url, {
      http,
      oEmbedProviders: [provider],
      fields: ['author', 'description'],
    });
    assert.equal(info?.title, 'A video');
    assert.equal(info?.author, 'A Channel');
    assert.equal(info?.description, 'About it');
    assert.ok(requests.some((r) => r.url === url && r.method === 'GET'));
  });

  it("keeps oEmbed's answer when the page can't be read", async () => {
    const { http } = fakeHttp((req) =>
      req.url.startsWith(provider.endpoint) ? route(req) : { status: 500 }
    );
    const info = await fetchPageInfo(url, {
      http,
      oEmbedProviders: [provider],
      fields: ['description'],
    });
    assert.equal(info?.title, 'A video');
    assert.equal(info?.description, null);
  });
});
