import assert from 'node:assert/strict';

import {
  DEFAULT_TEMPLATE,
  LINK_FORMATS,
  LinkValues,
  escapeHtml,
  localIsoDate,
  needsPageInfo,
  needsTitle,
  pageFieldsIn,
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

    it('encodes a space in a URL written as text, so the autolink holds', () => {
      assert.equal(
        renderLink('{title}: {url}', {
          title: 'T',
          url: 'https://example.com/Blue jay',
        }),
        'T: https://example.com/Blue%20jay'
      );
      assert.equal(
        renderLink('<{url}>', {
          title: '',
          url: 'https://example.com/Blue jay',
        }),
        '<https://example.com/Blue%20jay>'
      );
    });

    it('wraps a URL with a space in a destination in angle brackets', () => {
      assert.equal(
        renderLink('[{title}]({url})', {
          title: 'Blue jay',
          url: 'https://en.wikipedia.org/wiki/Blue jay',
        }),
        '[Blue jay](<https://en.wikipedia.org/wiki/Blue jay>)'
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

  it('accepts every page placeholder and a dated one', () => {
    assert.equal(
      validateTemplate(
        '[{title} - {author} | {site} §{section}]({url} "{description}") {date} {date:YYYY-MM-DD HH:mm}'
      ),
      null
    );
  });

  it('rejects {date:} with an empty format', () => {
    assert.deepEqual(validateTemplate('[{title}]({url}) {date:}'), {
      code: 'emptyDateFormat',
    });
    assert.deepEqual(validateTemplate('[{title}]({url}) {date:  }'), {
      code: 'emptyDateFormat',
    });
  });

  it('rejects a format on anything but {date}', () => {
    assert.deepEqual(validateTemplate('[{title:upper}]({url})'), {
      code: 'unknownPlaceholder',
      name: 'title:upper',
    });
  });

  it('accepts {?…} groups', () => {
    assert.equal(
      validateTemplate('[{title}{? › {section}}{? | {author}}]({url})'),
      null
    );
    assert.equal(
      validateTemplate('[{title}]({url} "{title}{? by {author}}")'),
      null
    );
    assert.equal(validateTemplate('[{title}]({?{url}})'), null);
  });

  it('accepts a group that passes through a quote or tag and back', () => {
    assert.equal(validateTemplate('[{title}]({url}{? "{description}"})'), null);
    assert.equal(
      validateTemplate('<a href="{url}"{? title="{description}"}>{title}</a>'),
      null
    );
    assert.equal(
      validateTemplate('[{title}]({url}){? by <b>{author}</b>}'),
      null
    );
  });

  it('rejects a group that is never closed', () => {
    assert.deepEqual(validateTemplate('[{title}]({url}){? via {site}'), {
      code: 'unclosedGroup',
    });
  });

  it('rejects a group inside another', () => {
    assert.deepEqual(
      validateTemplate('[{title}{? ({author}{? - {site}})}]({url})'),
      { code: 'nestedGroup' }
    );
  });

  it('rejects a group that ends in another part of the link', () => {
    assert.deepEqual(validateTemplate('{?[{title}]({url}}'), {
      code: 'groupUnbalanced',
    });
    assert.deepEqual(validateTemplate('[{title}{? | {author}]({url}})'), {
      code: 'groupUnbalanced',
    });
    // Back in a link title, but one in other quotes.
    assert.deepEqual(
      validateTemplate(`[{title}]({url} "{title}{?" '{author}}')`),
      { code: 'groupUnbalanced' }
    );
  });

  it('rejects a group that opens a bracket it does not close', () => {
    // Dropped, it would leave "](url)".
    assert.deepEqual(validateTemplate('{?[{author}}]({url})'), {
      code: 'groupUnbalanced',
    });
    assert.deepEqual(validateTemplate('[{title}]({url}{?({author}})'), {
      code: 'groupUnbalanced',
    });
  });

  it('rejects a group that closes a bracket it did not open', () => {
    assert.deepEqual(validateTemplate('[{title}{? | {author}]}({url})'), {
      code: 'groupUnbalanced',
    });
  });

  it('accepts a whole link, or an escaped bracket, in a group', () => {
    assert.equal(validateTemplate('{title}{? [{author}]({url})}'), null);
    assert.equal(validateTemplate('[{title}]({url}){? \\[{author}}'), null);
  });

  it('rejects a group without a placeholder', () => {
    assert.deepEqual(validateTemplate('[{title}{? - }]({url})'), {
      code: 'groupWithoutPlaceholder',
    });
    assert.deepEqual(validateTemplate('[{title}{?}]({url})'), {
      code: 'groupWithoutPlaceholder',
    });
  });
});

describe('needsPageInfo', () => {
  it('is true for any placeholder read from the page', () => {
    for (const name of ['title', 'author', 'site', 'description', 'section']) {
      assert.equal(needsPageInfo(`[x {${name}}]({url})`), true, name);
    }
  });

  it('is false for the URL, the domain and the date', () => {
    assert.equal(needsPageInfo('[{domain} {date}]({url})'), false);
    assert.equal(needsPageInfo('[{date:MMM D}]({url})'), false);
  });
});

describe('the page placeholders', () => {
  const values = {
    title: 'Title',
    url: 'https://example.com/a',
    author: 'Ada',
    site: 'Example',
    description: 'About it',
    section: 'Usage',
  };

  it('fills in each one', () => {
    assert.equal(
      renderLink(
        '[{title} by {author} on {site}, §{section}: {description}]({url})',
        values
      ),
      '[Title by Ada on Example, §Usage: About it](https://example.com/a)'
    );
  });

  it('escapes each one for where it sits, like the title', () => {
    const hostile = { ...values, author: '*Ada* [x]', description: 'say "hi"' };
    assert.equal(
      renderLink('[{author}]({url} "{description}")', hostile),
      '[\\*Ada\\* \\[x\\]](https://example.com/a "say \\"hi\\"")'
    );
    assert.equal(
      renderLink('<a href="{url}" title="{description}">{author}</a>', hostile),
      '<a href="https://example.com/a" title="say &quot;hi&quot;">\\*Ada\\* \\[x\\]</a>'
    );
  });
});

describe('{date}', () => {
  const values = { title: 'T', url: 'https://example.com' };

  it('formats with the formatter it is given, defaulting to YYYY-MM-DD', () => {
    const asked: string[] = [];
    const formatDate = (format: string) => {
      asked.push(format);
      return `<${format}>`;
    };
    assert.equal(
      renderLink('[{title}]({url}) {date} {date:D MMM}', {
        ...values,
        formatDate,
      }),
      '[T](https://example.com) <YYYY-MM-DD> <D MMM>'.replace(
        /[<>]/g,
        (c) => `\\${c}`
      )
    );
    assert.deepEqual(asked, ['YYYY-MM-DD', 'D MMM']);
  });

  it("falls back to the local ISO date when there's no formatter", () => {
    assert.equal(localIsoDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(
      renderLink('[{title}]({url}) {date}', values),
      `[T](https://example.com) ${localIsoDate()}`
    );
  });
});

describe('empty values', () => {
  const values = { title: 'Title', url: 'https://example.com' };
  const render = (template: string) => renderLink(template, values);

  it('take the separator before them along', () => {
    assert.equal(
      render('[{title} - {author}]({url})'),
      '[Title](https://example.com)'
    );
    assert.equal(
      render('[{title} | {site}]({url})'),
      '[Title](https://example.com)'
    );
    assert.equal(
      render('[{title} · {section}]({url})'),
      '[Title](https://example.com)'
    );
  });

  it('treat guillemets as separators', () => {
    assert.equal(
      render('[{title} › {section}]({url})'),
      '[Title](https://example.com)'
    );
    assert.equal(
      render('[{site} » {title}]({url})'),
      '[Title](https://example.com)'
    );
  });

  it('treat an arrow as a separator', () => {
    assert.equal(
      render('[{title} → {section}]({url})'),
      '[Title](https://example.com)'
    );
  });

  it('keep the separator after them when the one before goes', () => {
    assert.equal(
      renderLink('[{title} › {section} | {author}]({url})', {
        ...values,
        author: 'Channel',
      }),
      '[Title | Channel](https://example.com)'
    );
  });

  it('take the separator after them along when none comes before', () => {
    assert.equal(
      render('[{author}: {title}]({url})'),
      '[Title](https://example.com)'
    );
    assert.equal(
      render('[{site} - {title}]({url})'),
      '[Title](https://example.com)'
    );
  });

  it('drop the parentheses around them', () => {
    assert.equal(
      render('[{title}]({url}) ({author})'),
      '[Title](https://example.com)'
    );
  });

  it('leave one space where they sat between two words', () => {
    assert.equal(
      render('[{title} {author} here]({url})'),
      '[Title here](https://example.com)'
    );
  });

  it('keep the separators between values that are there', () => {
    assert.equal(
      render('[{title} - {author} - {domain}]({url})'),
      '[Title - example.com](https://example.com)'
    );
  });

  it('collapse inside a quoted link title too', () => {
    assert.equal(
      render('[{title}]({url} "{site} - {description}")'),
      '[Title](https://example.com "")'
    );
  });

  it("don't touch a destination or an HTML attribute", () => {
    assert.equal(
      render('<a href="{url}" data-x="- {author}">{title}</a>'),
      '<a href="https://example.com" data-x="- ">Title</a>'
    );
  });
});

describe('{?…} groups', () => {
  const url = 'https://example.com';
  const render = (template: string, more: Partial<LinkValues> = {}) =>
    renderLink(template, { title: 'Title', url, ...more });

  it('are written when their values are there', () => {
    assert.equal(
      render('[{title}{? | {author}}]({url})', { author: 'Ann' }),
      `[Title | Ann](${url})`
    );
  });

  it('are dropped whole when a value is missing', () => {
    assert.equal(render('[{title}{? | {author}}]({url})'), `[Title](${url})`);
    assert.equal(
      render('[{title}{? ({author}, {site})}]({url})', { author: 'Ann' }),
      `[Title](${url})`
    );
  });

  it('give each optional value its own separator (#20)', () => {
    const template = '[{title}{? › {section}}{? | {author}}]({url})';
    assert.equal(render(template, { author: 'Ann' }), `[Title | Ann](${url})`);
    assert.equal(
      render(template, { section: 'Usage' }),
      `[Title › Usage](${url})`
    );
    assert.equal(
      render(template, { section: 'Usage', author: 'Ann' }),
      `[Title › Usage | Ann](${url})`
    );
  });

  it('keep any text, not just separators', () => {
    assert.equal(
      render('[{title}]({url}){? (via {site})}', { site: 'YouTube' }),
      `[Title](${url}) (via YouTube)`
    );
    assert.equal(render('[{title}]({url}){? (via {site})}'), `[Title](${url})`);
  });

  it('escape their values for where they sit', () => {
    assert.equal(
      render('[{title}{? | {author}}]({url})', { author: 'A*B' }),
      `[Title | A\\*B](${url})`
    );
    assert.equal(
      render('[{title}]({url} "{title}{? by {author}}")', { author: 'A "B"' }),
      `[Title](${url} "Title by A \\"B\\"")`
    );
    assert.equal(
      render('<a href="{url}" title="{title}{? by {author}}">{title}</a>'),
      `<a href="${url}" title="Title">Title</a>`
    );
  });

  it('can hold a whole link title or HTML attribute', () => {
    const hover = '[{title}]({url}{? "{description}"})';
    assert.equal(
      render(hover, { description: 'About "it"' }),
      `[Title](${url} "About \\"it\\"")`
    );
    assert.equal(render(hover), `[Title](${url})`);

    const html = '<a href="{url}"{? title="{description}"}>{title}</a>';
    assert.equal(
      render(html, { description: 'A <b>' }),
      `<a href="${url}" title="A &lt;b&gt;">Title</a>`
    );
    assert.equal(render(html), `<a href="${url}">Title</a>`);
  });

  it('still lose a separator to an empty value outside them', () => {
    assert.equal(
      render('[{site}{? - {author}}]({url})', { author: 'Ann' }),
      `[Ann](${url})`
    );
  });

  it('count their page fields as shown', () => {
    assert.deepEqual(pageFieldsIn('[{title}{? | {author}}]({url})'), [
      'author',
    ]);
    assert.equal(needsPageInfo('[{domain}{? | {site}}]({url})'), true);
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

describe('pageFieldsIn', () => {
  it('lists the page fields a template shows besides the title', () => {
    assert.deepEqual(
      pageFieldsIn('[{title} - {author}]({url} "{description}") {author}'),
      ['author', 'description']
    );
    assert.deepEqual(pageFieldsIn('[{site}: {section}]({url})'), [
      'site',
      'section',
    ]);
  });

  it('is empty for the title, URL, domain and date alone', () => {
    assert.deepEqual(pageFieldsIn('[{title}]({url}) {domain} {date}'), []);
  });
});
