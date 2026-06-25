/**
 * Tests for popup.js
 *
 * HOW TO RUN:
 *   npm install
 *   npm test
 */

// jsdom needs a minimal DOM before popup.js loads
document.body.innerHTML = `
  <div class="tabs"></div>
  <div id="tab-subtitles" class="tab-content active"><div id="subtitle-list"></div><button id="clear-history-btn"></button></div>
  <div id="tab-dictionary" class="tab-content"><div id="dictionary-list"></div><input id="dict-search"/></div>
  <div id="tab-practice" class="tab-content"><div id="practice-area"></div></div>
  <div id="tab-stats" class="tab-content"><div id="stats-area"></div></div>
  <div id="update-banner" style="display:none"><span id="update-banner-text"></span><button id="update-banner-reload"></button></div>
`;

// chrome.storage.local.get must call the callback synchronously so init() can run
chrome.storage.local.get = jest.fn((keys, cb) => { cb && cb({}); });
chrome.storage.local.set = jest.fn((_obj, cb) => { cb && cb(); });
chrome.runtime.sendMessage = jest.fn(() => Promise.resolve({ history: [] }));

const p = require('../popup.js');

// Reset storage mocks and localStorage between every test
beforeEach(() => {
  chrome.storage.local._reset();
  chrome.storage.sync._reset();
  chrome.runtime.lastError = null;
  localStorage.clear();
});

const {
  escapeHtml,
  wordForm,
  extractCleanTitle,
  getSourceDisplayName,
  setSourceName,
  getSourceNames,
  translateText,
  storageGet,
  storageSet,
  wrapWordsClickable,
  isNewerVersion,
  getDueCards,
  gradeCard,
  addWordToDictionary,
  removeWordFromDictionary,
  restoreFromSync,
  bumpStat,
  _setDictionary,
  _getDictionary,
} = p;

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes < > & characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('leaves plain text untouched', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('handles apostrophes in contractions', () => {
    // Apostrophes are NOT escaped by textContent→innerHTML
    const result = escapeHtml("it's fine");
    expect(result).toBe("it's fine");
  });
});

// ─── wordForm ────────────────────────────────────────────────────────────────

describe('wordForm', () => {
  test.each([
    [1, 'слово'],
    [21, 'слово'],
    [2, 'слова'],
    [3, 'слова'],
    [4, 'слова'],
    [5, 'слов'],
    [11, 'слов'],  // 11-14 → "слов" regardless
    [12, 'слов'],
    [14, 'слов'],
    [15, 'слов'],
    [0, 'слов'],
    [100, 'слов'],
    [101, 'слово'],
  ])('wordForm(%i) === %s', (n, expected) => {
    expect(wordForm(n)).toBe(expected);
  });
});

// ─── extractCleanTitle ───────────────────────────────────────────────────────

describe('extractCleanTitle', () => {
  test('removes "– hdrezka.ag" suffix', () => {
    expect(extractCleanTitle('Breaking Bad (2008) – hdrezka.ag')).toBe('Breaking Bad (2008)');
  });

  test('removes "| rezka.ag" suffix', () => {
    expect(extractCleanTitle('Inception | rezka.ag')).toBe('Inception');
  });

  test('removes "смотреть онлайн бесплатно"', () => {
    expect(extractCleanTitle('Dune (2021) смотреть онлайн бесплатно')).toBe('Dune (2021)');
  });

  test('removes "watch online"', () => {
    expect(extractCleanTitle('The Bear watch online')).toBe('The Bear');
  });

  test('keeps year in title', () => {
    const cleaned = extractCleanTitle('Game of Thrones (2011–2019) – hdrezka.ag');
    expect(cleaned).toContain('(2011');
  });

  test('returns empty string for null/undefined', () => {
    expect(extractCleanTitle(null)).toBe('');
    expect(extractCleanTitle('')).toBe('');
  });

  test('does not mangle plain title', () => {
    expect(extractCleanTitle('Oppenheimer')).toBe('Oppenheimer');
  });
});

// ─── getSourceDisplayName / setSourceName ─────────────────────────────────────

describe('getSourceDisplayName', () => {
  beforeEach(() => {
    localStorage.setItem('rsd_source_names', JSON.stringify({}));
  });

  test('returns fallback when no URL', () => {
    expect(getSourceDisplayName('', 'Some Movie')).toBe('Some Movie');
    expect(getSourceDisplayName(null, 'Other')).toBe('Other');
  });

  test('returns "Без источника" when no url and no fallback', () => {
    expect(getSourceDisplayName('', '')).toBe('Без источника');
  });

  test('returns saved custom name', () => {
    setSourceName('https://rezka.ag/movie/1', 'Breaking Bad');
    expect(getSourceDisplayName('https://rezka.ag/movie/1', 'Fallback')).toBe('Breaking Bad');
  });

  test('returns fallback when URL not saved', () => {
    expect(getSourceDisplayName('https://rezka.ag/movie/2', 'Fallback')).toBe('Fallback');
  });

  test('deletes name when empty string passed to setSourceName', () => {
    setSourceName('https://rezka.ag/movie/3', 'Name');
    setSourceName('https://rezka.ag/movie/3', '');
    expect(getSourceDisplayName('https://rezka.ag/movie/3', 'Fallback')).toBe('Fallback');
  });

  test('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('rsd_source_names', 'NOT_JSON');
    expect(() => getSourceDisplayName('any-url', 'fb')).not.toThrow();
    expect(getSourceDisplayName('any-url', 'fb')).toBe('fb');
  });
});

// ─── wrapWordsClickable ──────────────────────────────────────────────────────

describe('wrapWordsClickable', () => {
  beforeEach(() => { _setDictionary([]); });

  test('wraps each word in a span.word', () => {
    const html = wrapWordsClickable('Hello world');
    expect(html).toContain('<span class="word" data-word="Hello">Hello</span>');
    expect(html).toContain('<span class="word" data-word="world">world</span>');
  });

  test('preserves punctuation outside spans', () => {
    const html = wrapWordsClickable('Hello, world!');
    expect(html).toContain(',');
    expect(html).toContain('!');
  });

  test('marks known words with "in-dict" class', () => {
    _setDictionary([{ word: 'Hello', translation: 'Привет' }]);
    const html = wrapWordsClickable('Hello world');
    expect(html).toContain('class="word in-dict"');
    expect(html).toContain('class="word"');
  });

  test('matching is case-insensitive for "in-dict" class', () => {
    _setDictionary([{ word: 'hello', translation: 'Привет' }]);
    const html = wrapWordsClickable('Hello');
    expect(html).toContain('in-dict');
  });

  test('handles "&" correctly — does not treat "amp" as a word', () => {
    // wrapWordsClickable now accepts raw text and escapes internally.
    // "&" should become "&amp;" in the output but "amp" must NOT be a clickable word.
    const html = wrapWordsClickable('cats & dogs');
    expect(html).not.toContain('data-word="amp"');
    expect(html).toContain('&amp;'); // correctly escaped entity in non-word part
    expect(html).toContain('data-word="cats"');
    expect(html).toContain('data-word="dogs"');
  });

  test('handles contractions correctly', () => {
    const html = wrapWordsClickable("it's fine");
    // "it's" should be one word (apostrophe is in character class)
    expect(html).toContain("data-word=\"it's\"");
    expect(html).not.toContain('data-word="s"');
  });
});

// ─── storageGet / storageSet ─────────────────────────────────────────────────

describe('storageGet / storageSet', () => {
  test('storageGet returns fallback when key missing', async () => {
    chrome.storage.local.get = jest.fn((_keys, cb) => cb({}));
    const val = await storageGet('missing_key', 42);
    expect(val).toBe(42);
  });

  test('storageGet returns stored value', async () => {
    chrome.storage.local.get = jest.fn((_keys, cb) => cb({ my_key: 'stored' }));
    const val = await storageGet('my_key', 'fallback');
    expect(val).toBe('stored');
  });

  test('storageSet calls chrome.storage.local.set', async () => {
    const mockSet = jest.fn((_obj, cb) => cb());
    chrome.storage.local.set = mockSet;
    await storageSet('some_key', { data: 1 });
    expect(mockSet).toHaveBeenCalledWith({ some_key: { data: 1 } }, expect.any(Function));
  });
});

// ─── translateText ───────────────────────────────────────────────────────────

describe('translateText', () => {
  afterEach(() => { global.fetch = undefined; });

  test('returns joined translation chunks', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([[['Привет', 'Hello'], ['мир', 'world']]]),
      })
    );
    const result = await translateText('Hello world');
    expect(result).toBe('Приветмир');
  });

  test('includes correct query params in URL', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([[['ok', 'ok']]]) })
    );
    await translateText('test', 'de', 'en');
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('tl=de');
    expect(url).toContain('sl=en');
    expect(url).toContain(encodeURIComponent('test'));
  });

  test('throws on non-OK response', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 429 })
    );
    await expect(translateText('hello')).rejects.toThrow('Translate request failed');
  });

  test('throws on network error', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network failure')));
    await expect(translateText('hello')).rejects.toThrow('Network failure');
  });
});

// ─── getDueCards ─────────────────────────────────────────────────────────────

describe('getDueCards', () => {
  const now = Date.now();

  test('returns cards due now or in the past', () => {
    _setDictionary([
      { id: '1', word: 'apple', dueAt: now - 1000 },
      { id: '2', word: 'bear', dueAt: now - 86400000 },
    ]);
    expect(getDueCards()).toHaveLength(2);
  });

  test('excludes cards due in the future', () => {
    _setDictionary([
      { id: '1', word: 'apple', dueAt: now + 86400000 },
    ]);
    expect(getDueCards()).toHaveLength(0);
  });

  test('returns empty array when dictionary is empty', () => {
    _setDictionary([]);
    expect(getDueCards()).toHaveLength(0);
  });

  test('mixes due and future cards correctly', () => {
    _setDictionary([
      { id: '1', word: 'apple', dueAt: now - 1 },
      { id: '2', word: 'bear', dueAt: now + 100000 },
      { id: '3', word: 'cat', dueAt: now - 500 },
    ]);
    const due = getDueCards();
    expect(due.map((d) => d.id).sort()).toEqual(['1', '3']);
  });
});

// ─── gradeCard ───────────────────────────────────────────────────────────────

describe('gradeCard', () => {
  function makeCard(overrides = {}) {
    return {
      id: 'test-1',
      word: 'test',
      translation: 'тест',
      interval: 0,
      repetitions: 0,
      easeFactor: 2.5,
      dueAt: Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    _setDictionary([]);
    chrome.storage.local.set = jest.fn((_o, cb) => cb && cb());
    chrome.storage.sync.set = jest.fn((_o, cb) => cb && cb());
    chrome.storage.local.get = jest.fn((_k, cb) => cb({ rsd_stats: { wordsAdded: 0, reviewsDone: 0, linesTranslated: 0 } }));
  });

  test('grade 0 (forgot): resets repetitions and sets interval=1', async () => {
    const card = makeCard({ repetitions: 3, interval: 7 });
    _setDictionary([card]);
    await gradeCard(card, 0);
    expect(card.repetitions).toBe(0);
    expect(card.interval).toBe(1);
    expect(card.dueAt).toBeGreaterThan(Date.now());
  });

  test('grade 3 (hard): advances repetitions, decreases easeFactor', async () => {
    const card = makeCard({ repetitions: 0, interval: 0, easeFactor: 2.5 });
    _setDictionary([card]);
    await gradeCard(card, 3);
    expect(card.repetitions).toBe(1);
    expect(card.interval).toBe(1);
    expect(card.easeFactor).toBeLessThan(2.5); // decreased for grade 3
  });

  test('grade 4 (good): advances repetitions, easeFactor unchanged', async () => {
    const card = makeCard({ repetitions: 0, interval: 0, easeFactor: 2.5 });
    _setDictionary([card]);
    await gradeCard(card, 4);
    expect(card.repetitions).toBe(1);
    expect(card.easeFactor).toBeCloseTo(2.5, 5); // 0.1 - 1*(0.08+0.02) = 0 change
  });

  test('grade 5 (easy): increases easeFactor', async () => {
    const card = makeCard({ repetitions: 0, interval: 0, easeFactor: 2.5 });
    _setDictionary([card]);
    await gradeCard(card, 5);
    expect(card.easeFactor).toBeCloseTo(2.6, 5);
  });

  test('interval progression: 1 → 3 → ~7 for consecutive grade-4 reviews', async () => {
    const card = makeCard();
    _setDictionary([card]);
    await gradeCard(card, 4); // rep=1, interval=1
    expect(card.interval).toBe(1);
    await gradeCard(card, 4); // rep=2, interval=3
    expect(card.interval).toBe(3);
    await gradeCard(card, 4); // rep=3, interval=round(3*2.5)=7 (approx)
    expect(card.interval).toBeGreaterThanOrEqual(7);
  });

  test('easeFactor floor is 1.3', async () => {
    // Repeated grade-3 reviews should not push easeFactor below 1.3
    const card = makeCard({ easeFactor: 1.3, repetitions: 2, interval: 3 });
    _setDictionary([card]);
    for (let i = 0; i < 10; i++) await gradeCard(card, 3);
    expect(card.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  test('dueAt is always set to the future after grading', async () => {
    const before = Date.now();
    const card = makeCard();
    _setDictionary([card]);
    await gradeCard(card, 4);
    expect(card.dueAt).toBeGreaterThan(before);
  });

  // ⚠️  BUG: grade < 3 after > 2 reviews correctly resets, but interval goes
  // to 1 (not 0). Correct behaviour — no bug here. Confirmed.
});

// ─── addWordToDictionary ──────────────────────────────────────────────────────

describe('addWordToDictionary', () => {
  beforeEach(() => {
    _setDictionary([]);
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([[['тест', 'test']]]) })
    );
    chrome.storage.local.set = jest.fn((_o, cb) => cb && cb());
    chrome.storage.sync.set = jest.fn((_o, cb) => cb && cb());
    chrome.storage.local.get = jest.fn((_k, cb) =>
      cb({ rsd_stats: { wordsAdded: 0, reviewsDone: 0, linesTranslated: 0 } })
    );
  });

  test('adds new word with translation and SM-2 defaults', async () => {
    await addWordToDictionary('test', 'this is a test');
    const dict = _getDictionary();
    expect(dict).toHaveLength(1);
    expect(dict[0].word).toBe('test');
    expect(dict[0].interval).toBe(0);
    expect(dict[0].repetitions).toBe(0);
    expect(dict[0].easeFactor).toBe(2.5);
    expect(dict[0].id).toBeTruthy();
  });

  test('uses prefetched translation when provided', async () => {
    await addWordToDictionary('cat', 'a cat sat', 'кот');
    const dict = _getDictionary();
    expect(dict[0].translation).toBe('кот');
    expect(global.fetch).not.toHaveBeenCalled(); // no fetch needed
  });

  test('does not add duplicate word (case-insensitive)', async () => {
    await addWordToDictionary('Hello', '', 'Привет');
    await addWordToDictionary('hello', '', 'Привет2'); // same word, different case
    expect(_getDictionary()).toHaveLength(1);
  });

  test('fetches translation when not provided', async () => {
    await addWordToDictionary('dog', 'the dog runs');
    expect(global.fetch).toHaveBeenCalled();
    expect(_getDictionary()[0].translation).toBe('тест'); // from mock
  });

  test('uses "(ошибка перевода)" when translation fetch fails', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
    await addWordToDictionary('error-word', 'context');
    expect(_getDictionary()[0].translation).toBe('(ошибка перевода)');
  });

  test('stores source metadata', async () => {
    const source = { title: 'Breaking Bad', url: 'https://rezka.ag/film/1' };
    await addWordToDictionary('meth', 'context', 'метамфетамин', source);
    const entry = _getDictionary()[0];
    expect(entry.source.title).toBe('Breaking Bad');
    expect(entry.source.url).toBe('https://rezka.ag/film/1');
  });
});

// ─── removeWordFromDictionary ─────────────────────────────────────────────────

describe('removeWordFromDictionary', () => {
  beforeEach(() => {
    chrome.storage.local.set = jest.fn((_o, cb) => cb && cb());
    chrome.storage.sync.set = jest.fn((_o, cb) => cb && cb());
    _setDictionary([
      { id: 'abc', word: 'apple', translation: 'яблоко' },
      { id: 'def', word: 'bear', translation: 'медведь' },
    ]);
  });

  test('removes word by id', async () => {
    await removeWordFromDictionary('abc');
    const dict = _getDictionary();
    expect(dict).toHaveLength(1);
    expect(dict[0].id).toBe('def');
  });

  test('does nothing when id not found', async () => {
    await removeWordFromDictionary('nonexistent');
    expect(_getDictionary()).toHaveLength(2);
  });

  test('calls storageSet after removal', async () => {
    chrome.storage.local.set = jest.fn((_o, cb) => cb && cb());
    await removeWordFromDictionary('abc');
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });
});

// ─── restoreFromSync (бэкап теперь в background.js) ──────────────────────────

describe('restoreFromSync', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
  });

  test('returns [] when sync is empty', async () => {
    chrome.storage.sync.get = jest.fn((keys, cb) => cb({}));
    const result = await restoreFromSync();
    expect(result).toEqual([]);
  });

  test('reassembles chunked dictionary', async () => {
    const original = [{ id: '1', word: 'cat', translation: 'кот' }];
    const json = JSON.stringify(original);
    chrome.storage.sync.get = jest.fn((keys, cb) => {
      if (typeof keys === 'string' && keys === 'rsd_bak_n') {
        cb({ rsd_bak_n: 1 });
      } else {
        cb({ rsd_bak_0: json });
      }
    });
    const result = await restoreFromSync();
    expect(result).toEqual(original);
  });

  test('returns [] on corrupt JSON', async () => {
    chrome.storage.sync.get = jest.fn((keys, cb) => {
      if (typeof keys === 'string' && keys === 'rsd_bak_n') {
        cb({ rsd_bak_n: 1 });
      } else {
        cb({ rsd_bak_0: 'INVALID_JSON' });
      }
    });
    const result = await restoreFromSync();
    expect(result).toEqual([]);
  });
});

// ─── bumpStat ────────────────────────────────────────────────────────────────

describe('bumpStat', () => {
  beforeEach(() => {
    chrome.storage.local.get = jest.fn((_k, cb) =>
      cb({ rsd_stats: { wordsAdded: 5, reviewsDone: 3, linesTranslated: 0 } })
    );
    chrome.storage.local.set = jest.fn((_o, cb) => cb && cb());
  });

  test('increments wordsAdded', async () => {
    await bumpStat('wordsAdded');
    const saved = chrome.storage.local.set.mock.calls[0][0];
    expect(saved.rsd_stats.wordsAdded).toBe(6);
  });

  test('increments reviewsDone', async () => {
    await bumpStat('reviewsDone');
    const saved = chrome.storage.local.set.mock.calls[0][0];
    expect(saved.rsd_stats.reviewsDone).toBe(4);
  });

  test('linesTranslated is bumped by the translate button handler', () => {
    const popupSource = require('fs').readFileSync(require('path').join(__dirname, '../popup.js'), 'utf-8');
    const calls = (popupSource.match(/bumpStat\('linesTranslated'\)/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

// ─── isNewerVersion ───────────────────────────────────────────────────────────

describe('isNewerVersion', () => {
  const { isNewerVersion } = p;

  test('returns true when remote is newer (patch)', () => {
    expect(isNewerVersion('1.2.1', '1.2.0')).toBe(true);
  });

  test('returns true when remote is newer (minor)', () => {
    expect(isNewerVersion('1.3.0', '1.2.0')).toBe(true);
  });

  test('returns true when remote is newer (major)', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  test('returns false when versions are equal', () => {
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false);
  });

  test('returns false when remote is OLDER — no false "update available"', () => {
    expect(isNewerVersion('1.1.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.0', '1.3.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
  });

  test('handles minor version with two digits correctly', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    // String comparison "1.10.0" < "1.9.0" would give wrong result
  });
});
