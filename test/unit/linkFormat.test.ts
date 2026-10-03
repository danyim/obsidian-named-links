import assert from 'node:assert/strict';

import {
  DEFAULT_TEMPLATE,
  LINK_FORMATS,
  escapeHtml,
  needsTitle,
  renderLink,
  templateFor,
  validateTemplate,
} from '../../src/linkFormat';
import { mergeSettings } from '../../src/settings';
import { formatTitle } from '../../src/title';
import { linkDestination } from '../../src/url';

const HOSTILE = 'He said "hi" \\ <b>x</b> ] ) [y](z) & \'q\' *n*';

describe('renderLink', () => {
  describe('the default markdown format', () => {
    // Byte for byte what 1.0.0 wrote, so the default changes nothing.
    const cases: [string, string][] = [
      ['Plain title', 'https://example.com'],
      [HOSTILE, 'https://example.com/a?b=1&c=2'],
      ['Mercury', 'https://en.wikipedia.org/wiki/A_(b_(c))'],
      ['Unbalanced', 'https://example.com/a)b'],
      ['#tag $5 == a::b', 'https://example.com'],
    ];
    for (const [title, url] of cases) {
      it(`matches the 1.0.0 output for ${JSON.stringify(title)}`, () => {
        assert.equal(
          renderLink(DEFAULT_TEMPLATE, { title, url }),
          `[${formatTitle(title, 0)}](${linkDestination(url)})`
        );
      });
    }
  });

  it("keeps a selection's own markdown, escaping unpaired brackets", () => {
    assert.equal(
      renderLink(DEFAULT_TEMPLATE, {
        title: '*bold* [1',
        url: 'https://example.com',
        titleIsMarkdown: true,
      }),
      '[*bold* \\[1](https://example.com)'
    );
  });

  describe('a markdown link with a hover title', () => {
    const template = LINK_FORMATS['markdown-title'];

    it('repeats the title as the link title', () => {
      assert.equal(
        renderLink(template, { title: 'Page', url: 'https://example.com' }),
        '[Page](https://example.com "Page")'
      );
    });

    it('escapes quotes and backslashes in the link title', () => {
      assert.equal(
        renderLink(template, {
          title: 'a "b" \\ c',
          url: 'https://example.com',
        }),
        '[a "b" \\\\ c](https://example.com "a \\"b\\" \\\\ c")'
      );
    });

    it('escapes the quote the template uses', () => {
      assert.equal(
        renderLink("[{title}]({url} '{title}')", {
          title: 'it\'s "x"',
          url: 'https://example.com',
        }),
        '[it\'s "x"](https://example.com \'it\\\'s "x"\')'
      );
    });
  });

  describe('an HTML link', () => {
    const template = LINK_FORMATS.html;

    it('HTML-escapes the URL in the attribute', () => {
      assert.equal(
        renderLink(template, {
          title: 'Q&A',
          url: 'https://example.com/?a=1&b="2"',
        }),
        '<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">Q&A</a>'
      );
    });

    it("can't be broken out of by a hostile title", () => {
      const html = renderLink('<a href="{url}" title="{title}">{title}</a>', {
        title: HOSTILE,
        url: 'https://example.com/x',
      });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const links = doc.querySelectorAll('a');
      assert.equal(links.length, 1);
      assert.equal(links[0].getAttribute('href'), 'https://example.com/x');
      assert.equal(links[0].getAttribute('title'), HOSTILE);
      assert.equal(doc.querySelectorAll('b, script').length, 0);
    });

    it('opens in a new tab when the template says so (upstream #127)', () => {
      assert.equal(
        renderLink('<a href="{url}" target="_blank">{title}</a>', {
          title: 'Page',
          url: 'https://example.com',
        }),
        '<a href="https://example.com" target="_blank">Page</a>'
      );
    });
  });

  describe('custom templates', () => {
    it('can use a fixed title (upstream #139)', () => {
      assert.equal(
        renderLink('[source]({url})', {
          title: 'ignored',
          url: 'https://example.com',
        }),
        '[source](https://example.com)'
      );
    });

    it('fills in the domain without www.', () => {
      assert.equal(
        renderLink('[{title} ({domain})]({url})', {
          title: 'Page',
          url: 'https://www.example.com/a',
        }),
        '[Page (example.com)](https://www.example.com/a)'
      );
    });

    it('percent-encodes a title used inside a destination', () => {
      assert.equal(
        renderLink('[{title}](https://search.example/?q={title}) {url}', {
          title: 'a b) c',
          url: 'https://example.com',
        }),
        '[a b) c](https://search.example/?q=a%20b%29%20c) https://example.com'
      );
    });

    it('only encodes the brackets of an autolink', () => {
      assert.equal(
        renderLink('<{url}>', { title: '', url: 'https://example.com/a_b' }),
        '<https://example.com/a_b>'
      );
    });

    it('leaves a URL written as text unescaped, so it autolinks intact', () => {
      assert.equal(
        renderLink('{title}: {url}', {
          title: 'T_',
          url: 'https://example.com/a_b',
        }),
        'T\\_: https://example.com/a_b'
      );
    });

    it('leaves an unknown placeholder as written', () => {
      assert.equal(
        renderLink('[{titel}]({url})', {
          title: 'T',
          url: 'https://example.com',
        }),
        '[{titel}](https://example.com)'
      );
    });
  });
});

describe('validateTemplate', () => {
  it('accepts every preset', () => {
    for (const template of Object.values(LINK_FORMATS)) {
      assert.equal(validateTemplate(template), null, template);
    }
  });

  it('accepts a template without a title', () => {
    assert.equal(validateTemplate('[source]({url})'), null);
  });

  it('requires the URL', () => {
    assert.deepEqual(validateTemplate('[{title}](x)'), { code: 'missingUrl' });
  });

  it('rejects unknown placeholders', () => {
    assert.deepEqual(validateTemplate('[{titel}]({url})'), {
      code: 'unknownPlaceholder',
      name: 'titel',
    });
  });

  it('rejects a placeholder inside a tag but outside quotes', () => {
    assert.deepEqual(validateTemplate('<a href={url}>{title}</a>'), {
      code: 'unquotedInTag',
      name: 'url',
    });
  });
});

describe('needsTitle', () => {
  it('is true when the template shows the title anywhere', () => {
    assert.equal(needsTitle(DEFAULT_TEMPLATE), true);
    assert.equal(needsTitle('<a href="{url}" title="{title}">x</a>'), true);
  });

  it('is false for a template without one', () => {
    assert.equal(needsTitle('[source]({url})'), false);
    assert.equal(needsTitle('[{domain}]({url})'), false);
  });
});

describe('templateFor', () => {
  it('maps the presets', () => {
    assert.equal(
      templateFor({ linkFormat: 'html', customLinkFormat: '' }),
      LINK_FORMATS.html
    );
  });

  it('uses a valid custom template', () => {
    assert.equal(
      templateFor({ linkFormat: 'custom', customLinkFormat: '[x]({url})' }),
      '[x]({url})'
    );
  });

  it('falls back to the default for an invalid custom template', () => {
    assert.equal(
      templateFor({ linkFormat: 'custom', customLinkFormat: '{title}' }),
      DEFAULT_TEMPLATE
    );
  });
});

describe('escapeHtml', () => {
  it('escapes every character that can end an attribute or tag', () => {
    assert.equal(
      escapeHtml(`<a href="x" b='y'>&`),
      '&lt;a href=&quot;x&quot; b=&#39;y&#39;&gt;&amp;'
    );
  });
});

describe('mergeSettings and the link format', () => {
  it('drops an unknown format', () => {
    assert.equal(
      mergeSettings({ linkFormat: 'bbcode' }).linkFormat,
      'markdown'
    );
  });

  it('keeps a known one', () => {
    assert.equal(mergeSettings({ linkFormat: 'custom' }).linkFormat, 'custom');
  });
});
