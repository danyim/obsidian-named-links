import assert from 'node:assert/strict';

import {
  copiedLinkTitle,
  linkTextFromHtml,
  linkTextFromMozUrl,
  usefulLinkText,
} from '../../src/clipboardTitle';

// Clipboard samples in the shapes browsers and apps write them. Chromium
// hands text/html over without the Windows CF_HTML header, but keeps the
// fragment comments and the charset meta.
const EDGE_COPY_LINK =
  '<html><body><!--StartFragment--><a href="https://example.com/article">An article | Example</a><!--EndFragment--></body></html>';
const CHROME_LINK_DRAG =
  '<meta charset=\'utf-8\'><a href="https://example.com/a?b=1&amp;c=2" style="color: blue;">A dragged link</a>';
const GOOGLE_DOCS_CHIP =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><a href="https://docs.google.com/document/d/abc/edit" style="text-decoration:none;"><span style="font-size:11pt;color:#1155cc;">Quarterly plan</span></a></b>';
const TABLE_CELL =
  '<table><tr><td><a href="https://example.com/article">An article</a></td><td>Notes about it</td></tr></table>';
const LINK_IN_SENTENCE =
  '<p>See <a href="https://example.com/article">An article</a> for details.</p>';

describe('linkTextFromHtml', () => {
  it("reads Edge's Copy link", () => {
    assert.equal(
      linkTextFromHtml(EDGE_COPY_LINK, 'https://example.com/article'),
      'An article | Example'
    );
  });

  it("reads Chrome's link drag, matching an escaped href", () => {
    assert.equal(
      linkTextFromHtml(CHROME_LINK_DRAG, 'https://example.com/a?b=1&c=2'),
      'A dragged link'
    );
  });

  it("reads a Google Docs link chip's nested text", () => {
    assert.equal(
      linkTextFromHtml(
        GOOGLE_DOCS_CHIP,
        'https://docs.google.com/document/d/abc/edit'
      ),
      'Quarterly plan'
    );
  });

  it('matches the URL with or without www. and a trailing slash', () => {
    assert.equal(
      linkTextFromHtml(
        '<a href="https://www.example.com/">Home</a>',
        'https://example.com'
      ),
      'Home'
    );
  });

  it('ignores a link copied along with other content', () => {
    assert.equal(
      linkTextFromHtml(TABLE_CELL, 'https://example.com/article'),
      null
    );
    assert.equal(
      linkTextFromHtml(LINK_IN_SENTENCE, 'https://example.com/article'),
      null
    );
  });

  it('ignores HTML with more than one link, or a link elsewhere', () => {
    assert.equal(
      linkTextFromHtml(
        '<a href="https://example.com/a">A</a> <a href="https://example.com/b">B</a>',
        'https://example.com/a'
      ),
      null
    );
    assert.equal(
      linkTextFromHtml(
        '<a href="https://other.example/">Other</a>',
        'https://example.com/'
      ),
      null
    );
  });

  it("doesn't count a copied style block as content", () => {
    assert.equal(
      linkTextFromHtml(
        '<style>a { color: red; }</style><a href="https://example.com/x">Styled</a>',
        'https://example.com/x'
      ),
      'Styled'
    );
  });
});

describe('linkTextFromMozUrl', () => {
  it("reads Firefox's url-then-title format", () => {
    assert.equal(
      linkTextFromMozUrl(
        'https://example.com/article\nAn article',
        'https://example.com/article'
      ),
      'An article'
    );
  });

  it('ignores a different URL or a missing title line', () => {
    assert.equal(
      linkTextFromMozUrl(
        'https://other.example/\nOther',
        'https://example.com/'
      ),
      null
    );
    assert.equal(
      linkTextFromMozUrl('https://example.com/', 'https://example.com/'),
      null
    );
  });
});

describe('usefulLinkText', () => {
  const url = 'https://www.example.com/article';

  it('keeps descriptive text, tidied', () => {
    assert.equal(usefulLinkText('  An\n article  ', url), 'An article');
  });

  for (const text of [
    '',
    '   ',
    'https://www.example.com/article',
    'www.example.com/article',
    'example.com/article/',
    'example.com',
    'www.example.com',
    'https://elsewhere.example/page',
    // Another site's URL written without a scheme.
    'elsewhere.example/page',
    'here',
    'Click here!',
    'Read more…',
    'link',
    // Punctuation separates words rather than joining them.
    'click-here',
    'read_more',
    // Nothing but punctuation.
    '...',
    '→',
  ]) {
    it(`falls back to fetching for ${JSON.stringify(text)}`, () =>
      assert.equal(usefulLinkText(text, url), null));
  }

  for (const text of ['Node.js', 'ASP.NET Core', 'example.org']) {
    it(`keeps a dotted name like ${JSON.stringify(text)}`, () =>
      assert.equal(usefulLinkText(text, url), text));
  }
});

describe('copiedLinkTitle', () => {
  const url = 'https://example.com/article';

  it('prefers the HTML link text, then Firefox', () => {
    assert.equal(
      copiedLinkTitle(
        { html: EDGE_COPY_LINK, mozUrl: `${url}\nFrom Firefox` },
        url
      ),
      'An article | Example'
    );
    assert.equal(
      copiedLinkTitle(
        {
          html: '<a href="https://example.com/article">here</a>',
          mozUrl: `${url}\nFrom Firefox`,
        },
        url
      ),
      'From Firefox'
    );
  });

  it('returns null when nothing useful was carried', () => {
    assert.equal(copiedLinkTitle({}, url), null);
    assert.equal(copiedLinkTitle({ html: TABLE_CELL }, url), null);
  });
});
