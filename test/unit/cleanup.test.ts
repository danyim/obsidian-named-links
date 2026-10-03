import assert from 'node:assert/strict';

import {
  applyDomainTitleRules,
  applyTitleRules,
  cleanupTitle,
  hostLabel,
  parseDomainTitleRules,
  parseTitleRules,
  removeSiteName,
} from '../../src/cleanup';

describe('hostLabel', () => {
  const cases: [string, string | null][] = [
    ['https://www.nytimes.com/2026/a.html', 'nytimes'],
    ['https://github.com/owner/repo', 'github'],
    ['https://en.wikipedia.org/wiki/X', 'wikipedia'],
    ['https://www.bbc.co.uk/news', 'bbc'],
    ['https://www.abc.net.au/news', 'abc'],
    ['https://co.uk', 'co'],
    ['http://localhost:3000', null],
    ['http://127.0.0.1:8000/page', null],
  ];
  for (const [url, expected] of cases) {
    it(`reads ${url}`, () => assert.equal(hostLabel(url), expected));
  }
});

describe('removeSiteName', () => {
  const strip = (title: string, url: string, siteName: string | null = null) =>
    removeSiteName(title, siteName, url);

  it('drops a trailing site name matched by the host', () => {
    assert.equal(
      strip('Video - YouTube', 'https://www.youtube.com/watch?v=1'),
      'Video'
    );
    assert.equal(
      strip('owner/repo: About it · GitHub', 'https://github.com/owner/repo'),
      'owner/repo: About it'
    );
    assert.equal(
      strip('Page – Wikipedia', 'https://en.wikipedia.org/wiki/Page'),
      'Page'
    );
  });

  it('drops a leading site name', () => {
    assert.equal(
      strip('GitHub - owner/repo: About it', 'https://github.com/owner/repo'),
      'owner/repo: About it'
    );
  });

  it('drops the name from both ends', () => {
    assert.equal(
      strip('GitHub - owner/repo · GitHub', 'https://github.com/owner/repo'),
      'owner/repo'
    );
  });

  it('matches the declared site name over the host', () => {
    assert.equal(
      strip(
        'Docs page | MDN Web Docs',
        'https://developer.mozilla.org/x',
        'MDN Web Docs'
      ),
      'Docs page'
    );
  });

  it('ignores a leading "The" in the declared site name', () => {
    assert.equal(
      strip('A review - Verge', 'https://example.com/a', 'The Verge'),
      'A review'
    );
  });

  it('reads an abbreviated host against a spelled-out name', () => {
    // "The New York Times" spells nytimes as initials plus the last word.
    assert.equal(
      strip('An article | The New York Times', 'https://www.nytimes.com/a'),
      'An article'
    );
    assert.equal(
      strip('Markets - Wall Street Journal', 'https://www.wsj.com/a'),
      'Markets'
    );
  });

  it('matches a trailing segment that starts with the host name', () => {
    assert.equal(
      strip('A story - BBC News', 'https://www.bbc.com/news/1'),
      'A story'
    );
  });

  it("keeps a leading product name that starts with the site's name", () => {
    assert.equal(
      strip(
        'GitHub Copilot · Your AI pair programmer · GitHub',
        'https://github.com/features/copilot'
      ),
      'GitHub Copilot · Your AI pair programmer'
    );
  });

  it('keeps a title without a separator', () => {
    assert.equal(strip('YouTube', 'https://www.youtube.com'), 'YouTube');
    assert.equal(strip('Just a page', 'https://github.com'), 'Just a page');
  });

  it('keeps a separator that is part of the title', () => {
    assert.equal(
      strip('C - The Language | Example', 'https://example.com/c'),
      'C - The Language'
    );
    assert.equal(
      strip('C - The Language', 'https://example.com/c'),
      'C - The Language'
    );
  });

  it("doesn't take the page's subject for a longer site name", () => {
    // "Rust" is part of rust-lang, but here it names the page, not the site.
    assert.equal(
      strip(
        'Rust - The Rust Programming Language',
        'https://www.rust-lang.org/'
      ),
      'Rust - The Rust Programming Language'
    );
  });

  it('splits on an em dash and a guillemet', () => {
    assert.equal(
      strip('A post \u2014 Medium', 'https://medium.com/@a/b'),
      'A post'
    );
    assert.equal(strip('Docs » Python', 'https://docs.python.org/3/'), 'Docs');
  });

  it('needs spaces around the separator', () => {
    assert.equal(
      strip('Self-Hosting-GitHub', 'https://github.com'),
      'Self-Hosting-GitHub'
    );
  });

  it('never strips a title down to nothing', () => {
    // The trailing name goes; the one left is then the whole title.
    assert.equal(strip('GitHub - GitHub', 'https://github.com'), 'GitHub');
  });
});

describe('parseTitleRules', () => {
  it('reads literal and regex rules, skipping blanks and comments', () => {
    const { rules, problems } = parseTitleRules(
      '# a comment\n\n | My Site =>\n/^\\[(\\w+)\\] (.*)$/i => $2 ($1)\nfoo=>bar'
    );
    assert.deepEqual(problems, []);
    assert.equal(rules.length, 3);
    assert.equal('Story | My Site'.replace(rules[0].pattern, ''), 'Story ');
    assert.equal(rules[0].replacement, '');
    assert.equal(rules[1].pattern.flags, 'i');
    assert.equal(rules[2].replacement, 'bar');
  });

  it('treats regex characters in a literal pattern literally', () => {
    const { rules } = parseTitleRules('a.b => x');
    assert.equal(
      'a.b aXb'.replace(rules[0].pattern, rules[0].replacement),
      'x aXb'
    );
  });

  it('reports bad lines by number and skips them', () => {
    const { rules, problems } = parseTitleRules(
      'ok => fine\nno arrow here\n => empty\n/(unclosed/ => x'
    );
    assert.equal(rules.length, 1);
    assert.deepEqual(
      problems.map((p) => [p.line, p.kind]),
      [
        [2, 'missingArrow'],
        [3, 'emptyPattern'],
        [4, 'invalidRegex'],
      ]
    );
  });
});

describe('applyTitleRules', () => {
  const apply = (title: string, rules: string) =>
    applyTitleRules(title, parseTitleRules(rules).rules);

  it('replaces every occurrence of a literal pattern', () => {
    assert.equal(apply('a.b.c', '. => -'), 'a-b-c');
  });

  it("follows a regex's own flags", () => {
    assert.equal(apply('aa', '/a/ => b'), 'ba');
    assert.equal(apply('aa', '/a/g => b'), 'bb');
  });

  it('supports $1 in the replacement', () => {
    assert.equal(
      apply('[News] Story', '/^\\[(\\w+)\\] (.*)$/ => $2 ($1)'),
      'Story (News)'
    );
  });

  it('runs rules in order', () => {
    assert.equal(apply('abc', 'a => b\nb => c'), 'ccc');
  });

  it('collapses the whitespace a rule leaves behind', () => {
    assert.equal(apply('Story | My Site', '| My Site =>'), 'Story');
  });

  it('keeps the title when the rules empty it', () => {
    assert.equal(apply('Gone', '/.*/ =>'), 'Gone');
  });

  it('skips an invalid regex and runs the rest', () => {
    assert.equal(apply('abc', '/(/ => x\nb => B'), 'aBc');
  });
});

describe('parseDomainTitleRules', () => {
  it('reads a domain and a rule per line', () => {
    const { rules, problems } = parseDomainTitleRules(
      [
        '# comment',
        'github.com: /^GitHub - / =>',
        '*.substack.com: / \\| .*$/ =>',
        'https://www.youtube.com/: (Official Video) =>',
        'localhost:3000: Dev => Local',
        'example.com: a:b => c',
      ].join('\n')
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(
      rules.map((r) => [r.domain, r.rule.pattern.source, r.rule.replacement]),
      [
        ['github.com', '^GitHub - ', ''],
        ['substack.com', ' \\| .*$', ''],
        ['youtube.com', '\\(Official Video\\)', ''],
        ['localhost', 'Dev', 'Local'],
        ['example.com', 'a:b', 'c'],
      ]
    );
  });

  it('reports a line without a domain, and problems in the rule', () => {
    const { rules, problems } = parseDomainTitleRules(
      [
        'Wikipedia => WP',
        'not a domain: x => y',
        'github.com: /(/ =>',
        'x.com: nothing',
      ].join('\n')
    );
    assert.equal(rules.length, 0);
    assert.deepEqual(
      problems.map((p) => [p.line, p.kind]),
      [
        [1, 'missingDomain'],
        [2, 'missingDomain'],
        [3, 'invalidRegex'],
        [4, 'missingArrow'],
      ]
    );
  });
});

describe('applyDomainTitleRules', () => {
  const rules = parseDomainTitleRules(
    'github.com: /^GitHub - / =>\nx.com: /\\s+on X$/ =>'
  ).rules;

  it("runs only the rules for the URL's domain and its subdomains", () => {
    assert.equal(
      applyDomainTitleRules('GitHub - a/b', 'https://gist.github.com/x', rules),
      'a/b'
    );
    assert.equal(
      applyDomainTitleRules('Post on X', 'https://x.com/a/status/1', rules),
      'Post'
    );
  });

  it("doesn't run a rule for a domain that merely ends the same way", () => {
    assert.equal(
      applyDomainTitleRules('Show on X', 'https://netflix.com/title', rules),
      'Show on X'
    );
  });
});

describe('cleanupTitle', () => {
  it('runs the domain rules, then the page rules', () => {
    assert.equal(
      cleanupTitle('Draft: Notes', {
        url: 'https://example.com/a',
        siteName: null,
        removeSiteName: false,
        domainRules: 'example.com: Draft => Final',
        pageRules: '/^Final: (.*)$/ => $1 (final)',
      }),
      'Notes (final)'
    );
  });

  it('runs either set alone', () => {
    const base = {
      url: 'https://example.com/a',
      siteName: null,
      removeSiteName: false,
    };
    assert.equal(
      cleanupTitle('A B', {
        ...base,
        domainRules: 'example.com: A => Z',
        pageRules: '',
      }),
      'Z B'
    );
    assert.equal(
      cleanupTitle('A B', { ...base, domainRules: '', pageRules: 'B => Y' }),
      'A Y'
    );
  });

  it('removes the site name before the rules run', () => {
    assert.equal(
      cleanupTitle('  [Draft]  Notes - YouTube ', {
        url: 'https://youtube.com/watch?v=1',
        siteName: null,
        removeSiteName: true,
        domainRules: '',
        pageRules: '/^\\[Draft\\] / =>',
      }),
      'Notes'
    );
  });

  it('leaves the title alone with both settings off', () => {
    assert.equal(
      cleanupTitle('Video - YouTube', {
        url: 'https://youtube.com',
        siteName: null,
        removeSiteName: false,
        domainRules: '',
        pageRules: '',
      }),
      'Video - YouTube'
    );
  });
});
