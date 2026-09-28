/** The scraper's HTTP client, backed by Obsidian's requestUrl. */
import { requestUrl } from 'obsidian';

import type { HttpClient } from './scraper';

/**
 * requestUrl bypasses CORS on desktop and mobile alike, which is why it
 * replaces both upstream's fetch() HEAD check (blocked by CORS on most sites)
 * and its BrowserWindow. It has no timeout of its own, and a request that
 * never settles left upstream's placeholder in the note for good (upstream
 * #167), so each request gets one here.
 */
export function obsidianHttpClient(timeoutMs: number): HttpClient {
  return (request) =>
    new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error(`Timed out after ${timeoutMs} ms`)),
        timeoutMs
      );
      requestUrl({
        url: request.url,
        method: request.method,
        headers: request.headers,
        throw: false,
      }).then(
        (res) => {
          window.clearTimeout(timer);
          resolve({
            status: res.status,
            headers: res.headers,
            body: () => res.arrayBuffer,
          });
        },
        (err: unknown) => {
          window.clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
}
