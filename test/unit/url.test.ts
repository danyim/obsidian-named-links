import assert from 'node:assert/strict';

import {
  decodeUrlForDisplay,
  fileNameFromUrl,
  findLinks,
  isFileUrl,
  isImageUrl,
  isUrl,
  linkAt,
  linkDestination,
  titleOntoUrl,
  toAbsoluteUrl,
  unwrapAutolink,
} from '../../src/url';

describe('isUrl', () => {
  const valid = [
    'http://example.com',
    'https://example.com',
    'https://www.example.com',
    'https://example.com/path/to/page',
    'https://example.com/page?foo=bar&baz=qux',
    'https://example.com/page#section',
    'https://sub.domain.example.com',
    'https://x.com',
    'https://openclaw.ai',
    'https://example.com:8080/path',
    'http://localhost:3000/docs',
    'http://127.0.0.1:8000',
    'https://en.wikipedia.org/wiki/Mercury_(planet)',
    'https://例え.jp/パス',
    // Hyphenated hosts, from yuu1111/obsidian-auto-link-title's suite
    // (upstream #154).
    'http://www-cs-students.stanford.edu/~amitp/',
    'https://my-awesome-site.com',
    'https://this-is-a-very-long-domain.example.com',
    'https://co-op.example.org',
    '  https://example.com\n',
  ];
  for (const url of valid) {
    it(`accepts ${JSON.stringify(url)}`, () => assert.equal(isUrl(url), true));
  }

  const invalid = [
    '',
    'example.com',
    'ftp://example.com',
    'https://com',
    'https://foo.',
    'not a url',
    'https://example .com',
    'https://a.com https://b.com',
    'javascript:alert(1)',
    'mailto:someone@example.com',
  ];
  for (const text of invalid) {
    it(`rejects ${JSON.stringify(text)}`, () =>
      assert.equal(isUrl(text), false));
  }
});

describe('toAbsoluteUrl', () => {
  it('adds https:// to a bare www. host (upstream #12)', () => {
    assert.equal(
      toAbsoluteUrl('www.example.com/a'),
      'https://www.example.com/a'
    );
  });

  it('keeps the URL as typed otherwise', () => {
    assert.equal(toAbsoluteUrl('HTTPS://Example.com'), 'HTTPS://Example.com');
  });
});

describe('isImageUrl', () => {
  it('recognizes an image by its path extension', () => {
    assert.equal(isImageUrl('https://example.com/cat.PNG'), true);
    assert.equal(isImageUrl('https://example.com/a/b.webp'), true);
  });

  it("doesn't mistake an .ai host for an Illustrator file (upstream #172)", () => {
    assert.equal(isImageUrl('https://openclaw.ai'), false);
    assert.equal(isImageUrl('https://openclaw.ai/'), false);
  });

  it('ignores the query string', () => {
    assert.equal(isImageUrl('https://example.com/page?x=cat.png'), false);
  });
});

describe('isFileUrl and fileNameFromUrl', () => {
  it('names a file by its decoded last segment', () => {
    const url = 'https://example.com/docs/Annual%20report.pdf';
    assert.equal(isFileUrl(url), true);
    assert.equal(fileNameFromUrl(url), 'Annual report.pdf');
  });

  it('skips a trailing slash', () => {
    assert.equal(fileNameFromUrl('https://example.com/a/b/'), 'b');
  });

  it('has no name for a bare host', () => {
    assert.equal(fileNameFromUrl('https://example.com'), null);
  });

  it('treats page extensions as pages', () => {
    assert.equal(isFileUrl('https://example.com/index.html'), false);
    assert.equal(isFileUrl('https://example.com/view.php?id=1'), false);
  });
});

describe('decodeUrlForDisplay', () => {
  it('decodes UTF-8 escapes, as in #6', () => {
    assert.equal(
      decodeUrlForDisplay('https://jisho.org/word/%E5%AF%BF%E5%8F%B8'),
      'https://jisho.org/word/寿司'
    );
    assert.equal(
      decodeUrlForDisplay('https://example.com/%F0%9F%98%80'),
      'https://example.com/😀'
    );
  });

  it('decodes lowercase escapes and unreserved ASCII', () => {
    assert.equal(
      decodeUrlForDisplay('https://example.com/%e5%af%bf/%41%2D%2E%5F%7E'),
      'https://example.com/寿/A-._~'
    );
  });

  it('decodes a space into a real space', () => {
    assert.equal(
      decodeUrlForDisplay('https://en.wikipedia.org/wiki/Blue%20jay'),
      'https://en.wikipedia.org/wiki/Blue jay'
    );
  });

  // Every ASCII character that stays encoded, upper and lower case hex.
  const kept = '%:/?#[]@!$&\'()*+,;=<>"\\^`{|}';
  for (const ch of kept) {
    const hex = ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    it(`keeps ${JSON.stringify(ch)} encoded as %${hex}`, () => {
      for (const escape of [`%${hex}`, `%${hex.toLowerCase()}`]) {
        const url = `https://example.com/a${escape}b`;
        assert.equal(decodeUrlForDisplay(url), url);
      }
    });
  }

  it('keeps controls, other whitespace and invisible characters encoded', () => {
    for (const escape of [
      '%09', // tab
      '%0A', // newline
      '%7F', // delete
      '%C2%A0', // no-break space
      '%E2%80%8B', // zero-width space
      '%E2%80%AE', // right-to-left override
      '%E3%80%80', // ideographic space
      '%EF%BB%BF', // byte order mark
    ]) {
      const url = `https://example.com/a${escape}b`;
      assert.equal(decodeUrlForDisplay(url), url, escape);
    }
  });

  it('leaves escapes that are not valid UTF-8 as written', () => {
    for (const url of [
      'https://example.com/caf%E9', // Latin-1
      'https://example.com/%E5%AF', // truncated sequence
      'https://example.com/%C0%AF', // overlong
      'https://example.com/%80', // lone continuation byte
    ]) {
      assert.equal(decodeUrlForDisplay(url), url);
    }
  });

  it('decodes the valid parts of a mixed run', () => {
    assert.equal(
      decodeUrlForDisplay('https://example.com/%E9%E5%AF%BF%2F%41'),
      'https://example.com/%E9寿%2FA'
    );
  });

  it('decodes in the query and fragment, keeping their delimiters', () => {
    assert.equal(
      decodeUrlForDisplay(
        'https://example.com/s?q=%E5%AF%BF%26x%3D1&lang=ja#%E5%8F%B8'
      ),
      'https://example.com/s?q=寿%26x%3D1&lang=ja#司'
    );
  });

  it('leaves an already-decoded URL unchanged', () => {
    for (const url of [
      'https://jisho.org/word/寿司',
      'https://example.com/a?b=c#d',
      'https://xn--r8jz45g.jp/',
    ]) {
      assert.equal(decodeUrlForDisplay(url), url);
    }
  });
});

describe('linkDestination', () => {
  it('wraps a URL with a space in angle brackets', () => {
    assert.equal(
      linkDestination('https://en.wikipedia.org/wiki/Blue jay'),
      '<https://en.wikipedia.org/wiki/Blue jay>'
    );
  });

  it('leaves balanced parentheses alone', () => {
    const url = 'https://en.wikipedia.org/wiki/Mercury_(planet)';
    assert.equal(linkDestination(url), url);
  });

  it('wraps a URL with nested parentheses in angle brackets', () => {
    // Bare, the placeholder's link couldn't be found again to replace it.
    assert.equal(
      linkDestination('https://en.wikipedia.org/wiki/A_(b_(c))'),
      '<https://en.wikipedia.org/wiki/A_(b_(c))>'
    );
  });

  it('wraps a URL with an unbalanced parenthesis in angle brackets', () => {
    assert.equal(
      linkDestination('https://example.com/a)b'),
      '<https://example.com/a)b>'
    );
  });
});

describe('findLinks and linkAt', () => {
  it('finds a bare URL at the very start of a line', () => {
    // Upstream tested `!match.index`, which is true for index 0.
    const line = 'https://example.com is great';
    const link = linkAt(line, 0);
    assert.deepEqual(link, {
      start: 0,
      end: 19,
      url: 'https://example.com',
    });
  });

  it('finds the URL the cursor touches at its end', () => {
    const line = 'see https://example.com';
    assert.equal(linkAt(line, line.length)?.url, 'https://example.com');
  });

  it('returns null away from any URL', () => {
    assert.equal(linkAt('see https://example.com later', 1), null);
  });

  it('finds a markdown link with its text', () => {
    const line = 'a [Old title](https://example.com/x) b';
    const link = linkAt(line, 5);
    assert.equal(link?.url, 'https://example.com/x');
    assert.equal(link?.text, 'Old title');
    assert.equal(
      line.slice(link.start, link.end),
      '[Old title](https://example.com/x)'
    );
  });

  it('keeps balanced parentheses inside a markdown link', () => {
    const line = '[M](https://en.wikipedia.org/wiki/Mercury_(planet))';
    assert.equal(
      linkAt(line, 2)?.url,
      'https://en.wikipedia.org/wiki/Mercury_(planet)'
    );
  });

  it('trims sentence punctuation and a closing parenthesis', () => {
    const [link] = findLinks('(see https://example.com/a.)');
    assert.equal(link.url, 'https://example.com/a');
  });

  it("doesn't treat an image embed as a link", () => {
    const links = findLinks('![alt](https://example.com/a.png)');
    assert.equal(
      links.some((l) => l.text !== undefined),
      false
    );
  });

  it('skips a URL in an HTML attribute', () => {
    assert.deepEqual(findLinks('<a href="https://example.com">x</a>'), []);
  });

  it('takes an autolink whole, brackets included', () => {
    const line = 'see <https://example.com> now';
    const link = linkAt(line, 10);
    assert.equal(line.slice(link!.start, link!.end), '<https://example.com>');
    assert.equal(link!.url, 'https://example.com');
  });

  it('leaves URLs that are already part of markup alone', () => {
    for (const line of [
      '![](https://example.com/img?id=5)',
      '[t](https://example.com "Title")',
      '[a [b] c](https://example.com)',
      '[ref]: https://example.com',
      '  [ref]:https://example.com',
    ]) {
      assert.deepEqual(
        findLinks(line).filter((l) => l.text === undefined),
        [],
        line
      );
    }
  });

  it('still finds a URL in parentheses in prose', () => {
    assert.equal(
      findLinks('(https://example.com)')[0]?.url,
      'https://example.com'
    );
  });

  it('reads a decoded space in a <...> destination back as %20', () => {
    // Decode URLs writes a URL with a space in the <...> form; the link has
    // to be found again, e.g. by the enhance command.
    const link = linkAt('[Word](<https://example.com/Blue jay>)', 2);
    assert.equal(link?.url, 'https://example.com/Blue%20jay');
    assert.equal(link?.text, 'Word');
  });

  it('finds several URLs in order', () => {
    const urls = findLinks('Visit https://example.com and http://test.org').map(
      (l) => l.url
    );
    assert.deepEqual(urls, ['https://example.com', 'http://test.org']);
  });
});

describe('unwrapAutolink', () => {
  it('strips the brackets of an autolink (upstream #156)', () => {
    assert.equal(
      unwrapAutolink('<https://example.com>'),
      'https://example.com'
    );
  });

  it('leaves other text alone', () => {
    assert.equal(unwrapAutolink('https://example.com'), 'https://example.com');
    assert.equal(unwrapAutolink('<>'), '<>');
  });
});

describe('titleOntoUrl', () => {
  const url = 'https://example.com/a';

  it('takes a bare URL selection and a line of text (issue #7)', () => {
    assert.deepEqual(titleOntoUrl(url, 'My page'), {
      url,
      title: 'My page',
      before: '',
      after: '',
    });
  });

  it('takes an autolink and a whole markdown link', () => {
    assert.equal(titleOntoUrl(`<${url}>`, 'T')?.url, url);
    assert.equal(titleOntoUrl(`[old title](${url})`, 'New')?.url, url);
    assert.equal(titleOntoUrl(`[old](<${url}>)`, 'New')?.url, url);
  });

  it('keeps whitespace selected around the URL', () => {
    const result = titleOntoUrl(` ${url}\n`, 'T');
    assert.equal(result?.before, ' ');
    assert.equal(result?.after, '\n');
  });

  it('trims the pasted text and makes a www. URL absolute', () => {
    assert.deepEqual(titleOntoUrl('www.example.com', '  Spaced  \n'), {
      url: 'https://www.example.com',
      title: 'Spaced',
      before: '',
      after: '',
    });
  });

  it('leaves a URL pasted over a URL to the ordinary paste', () => {
    assert.equal(titleOntoUrl(url, 'https://other.example.com'), null);
    assert.equal(titleOntoUrl(url, 'https://a.com https://b.com'), null);
    assert.equal(titleOntoUrl(url, '<https://other.example.com>'), null);
  });

  it('refuses empty or multi-line text', () => {
    assert.equal(titleOntoUrl(url, ''), null);
    assert.equal(titleOntoUrl(url, '   '), null);
    assert.equal(titleOntoUrl(url, 'one\ntwo'), null);
  });

  it('refuses a selection that is more than a URL', () => {
    assert.equal(titleOntoUrl(`see ${url}`, 'T'), null);
    assert.equal(titleOntoUrl(`${url} ${url}`, 'T'), null);
    assert.equal(titleOntoUrl(`[a](${url}) and more`, 'T'), null);
    assert.equal(titleOntoUrl(`![img](${url})`, 'T'), null);
    assert.equal(titleOntoUrl('just words', 'T'), null);
    assert.equal(titleOntoUrl('', 'T'), null);
  });
});
