/**
 * A local HTTP server with a page for each case the scraper has to handle,
 * so the e2e suite never depends on the internet or on how some real site
 * looks today. Each wdio worker starts its own on a free port.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';

export interface LoggedRequest {
  method: string;
  path: string;
  userAgent: string;
}

const log: LoggedRequest[] = [];
let server: http.Server | null = null;
let base: Promise<string> | null = null;

/** The title the /hostile page decodes to. */
export const HOSTILE_TITLE = 'He said "hi" \\ <b>x</b> ] ) [y](z) & \'q\' *n*';

const GBK_TITLE = Buffer.from('d6d0cec4b1eacce2', 'hex'); // 中文标题

function page(title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><p>${title}</p></body></html>`;
}

function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://fixture');
  log.push({
    method: req.method ?? 'GET',
    path: url.pathname + url.search,
    userAgent: req.headers['user-agent'] ?? '',
  });

  const html = (body: string | Buffer, type = 'text/html; charset=utf-8') => {
    res.writeHead(200, { 'Content-Type': type });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  switch (url.pathname) {
    case '/page':
      // ?title=... sets the title, so a spec can use a distinct one per URL.
      return html(page(url.searchParams.get('title') ?? 'Fixture page'));
    case '/site': {
      // A page that declares its site's name, for removing it from the
      // title: ?title=... and ?site=..., the latter left out if not given.
      const title = url.searchParams.get('title') ?? 'Fixture page';
      const site = url.searchParams.get('site');
      const meta = site
        ? `<meta property="og:site_name" content="${site}">`
        : '';
      return html(
        `<!doctype html><html><head><meta charset="utf-8">${meta}<title>${title}</title></head></html>`
      );
    }
    case '/markdown':
      return html(page('A *bold* [claim] | with `code` &amp; $5'));
    case '/hostile':
      // Every character that could end a link's text, target, title
      // attribute or HTML tag. Reads as HOSTILE_TITLE once decoded.
      return html(
        page(
          "He said &quot;hi&quot; \\ &lt;b&gt;x&lt;/b&gt; ] ) [y](z) &amp; 'q' *n*"
        )
      );
    case '/multiline':
      return html(page('First line\n   second line'));
    case '/og':
      return html(
        '<html><head><title></title><meta property="og:title" content="Open Graph title"></head></html>'
      );
    case '/gbk':
      return html(
        Buffer.concat([
          Buffer.from('<html><head><title>'),
          GBK_TITLE,
          Buffer.from('</title></head></html>'),
        ]),
        'text/html; charset=GBK'
      );
    case '/notitle':
      return html('<html><body>No title here</body></html>');
    case '/challenge':
      return html(page('Just a moment...'));
    case '/missing':
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end(page('Not Found'));
    case '/download':
      // A file behind a path with no extension: only the Content-Type says
      // it isn't a page.
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(
        req.method === 'HEAD' ? undefined : Buffer.alloc(64 * 1024)
      );
    case '/redirect':
      res.writeHead(302, { Location: '/page?title=Redirected' });
      return res.end();
    case '/slow': {
      // Answers after ?ms= milliseconds, or never if none is given.
      const ms = Number(url.searchParams.get('ms'));
      if (!ms) return;
      setTimeout(
        () => html(page(url.searchParams.get('title') ?? 'Slow page')),
        ms
      );
      return;
    }
    case '/fixupx':
      return html(
        '<html><head><title>FxTwitter</title><meta property="og:title" content="Someone (@someone)"></head></html>'
      );
    default:
      // Any path under /word/, such as a percent-encoded one, is a page
      // titled with its last segment decoded, for the URL decoding specs.
      if (url.pathname.startsWith('/word/')) {
        const segment = url.pathname.split('/').pop() ?? '';
        return html(page(`Word ${decodeURIComponent(segment)}`));
      }
      res.writeHead(404);
      res.end();
  }
}

/** The server's base URL, e.g. http://127.0.0.1:43123, starting it if needed. */
export function fixtureBase(): Promise<string> {
  if (!base) {
    base = new Promise((resolve) => {
      server = http.createServer(handle);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }
  return base;
}

export function requestLog(): LoggedRequest[] {
  return [...log];
}

export function clearRequestLog(): void {
  log.length = 0;
}

export async function stopFixtureServer(): Promise<void> {
  if (!server) return;
  // closeAllConnections drops the /slow requests left hanging on purpose.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  base = null;
}
