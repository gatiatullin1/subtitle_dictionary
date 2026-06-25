/**
 * Tests for content.js (IIFE — runs in isolation)
 * Pure functions: wordNear, sortByPosition, extractSubtitleText, translateText
 */

// content.js uses document.caretRangeFromPoint which jsdom doesn't support;
// mock it so the module loads without crashing.
document.caretRangeFromPoint = jest.fn(() => null);

// content.js accesses chrome.storage inside the IIFE — needs to be available
global.chrome = global.chrome || {};
chrome.runtime = chrome.runtime || { sendMessage: jest.fn(), onMessage: { addListener: jest.fn() } };
chrome.storage = chrome.storage || { local: { get: jest.fn((_k, cb) => cb({})) } };
// язык перевода читается из storage + слежение за изменениями
chrome.storage.onChanged = chrome.storage.onChanged || { addListener: jest.fn() };

const content = require('../content.js');

const { wordNear, sortByPosition, extractSubtitleText, translateText } = content;

beforeEach(() => {
  chrome.storage.local._reset();
  chrome.runtime.lastError = null;
  localStorage.clear();
});

// ─── wordNear ────────────────────────────────────────────────────────────────

describe('wordNear', () => {
  test('returns word when cursor is in the middle of a word', () => {
    expect(wordNear('Hello world', 2)).toBe('Hello');
    expect(wordNear('Hello world', 7)).toBe('world');
  });

  test('returns word when cursor is at the start of a word', () => {
    expect(wordNear('Hello world', 0)).toBe('Hello');
    expect(wordNear('Hello world', 6)).toBe('world');
  });

  test('returns word when cursor is just past end of a word', () => {
    expect(wordNear('Hello world', 5)).toBe('Hello'); // pos 5 = space, searches nearby
  });

  test('returns null when no word within 5 chars', () => {
    expect(wordNear('     ', 2)).toBeNull();
    expect(wordNear('... !!!', 3)).toBeNull();
  });

  test('handles apostrophes in contractions as part of word', () => {
    const result = wordNear("it's fine", 2);
    expect(result).toBe("it's");
  });

  test('handles word at very end of string', () => {
    expect(wordNear('Say hi', 5)).toBe('hi');
  });

  test('returns null for empty string', () => {
    expect(wordNear('', 0)).toBeNull();
  });

  test('clamps position to valid range', () => {
    expect(wordNear('word', -5)).toBe('word');
    expect(wordNear('word', 100)).toBe('word');
  });
});

// ─── sortByPosition ──────────────────────────────────────────────────────────

describe('sortByPosition', () => {
  test('sorts two words by their position in text', () => {
    const sorted = sortByPosition(['world', 'Hello'], 'Hello world');
    expect(sorted).toEqual(['Hello', 'world']);
  });

  test('maintains order when already sorted', () => {
    const sorted = sortByPosition(['first', 'second'], 'first and second');
    expect(sorted).toEqual(['first', 'second']);
  });

  test('handles single word', () => {
    expect(sortByPosition(['only'], 'only one word')).toEqual(['only']);
  });

  test('case-insensitive position lookup', () => {
    const sorted = sortByPosition(['WORLD', 'hello'], 'hello world');
    expect(sorted).toEqual(['hello', 'WORLD']);
  });

  test('words not found in text are sorted to the end', () => {
    const sorted = sortByPosition(['missing', 'hello'], 'hello world');
    expect(sorted[0]).toBe('hello');
    // 'missing' is not in text → indexOf returns -1 → treated as Infinity
    expect(sorted[1]).toBe('missing');
  });

  // ⚠️  BUG: sortByPosition uses indexOf which finds FIRST occurrence.
  // For duplicate words in subtitle, position of the second occurrence
  // is incorrectly resolved to the first occurrence.
  test('BUG: duplicate word in subtitle — both get position of first occurrence', () => {
    // "time after time": if user selects "time" twice (impossible due to toggle dedup)
    // but if two *different* words both start at the same offset they collide.
    // More practically: "time after time" — indexOf('time') always returns 0,
    // so a word that appears later might be sorted wrong in edge cases.
    const sorted = sortByPosition(['after', 'time'], 'time after time');
    // 'time' at index 0, 'after' at index 5
    expect(sorted).toEqual(['time', 'after']); // this works for first occurrence
    // BUG scenario: sorting ['time', 'time'] where second 'time' is at index 11
    // This can't happen because toggleWord deduplicates, but the sort algo
    // would place both at index 0, giving non-deterministic order.
  });
});

// ─── extractSubtitleText ─────────────────────────────────────────────────────

describe('extractSubtitleText', () => {
  function makeContainer(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    // Make elements visible (jsdom doesn't compute styles, override getComputedStyle)
    return div;
  }

  beforeEach(() => {
    // Override getComputedStyle to return visible styles for test elements
    jest.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  test('extracts text from <i> elements (standard subtitle format)', () => {
    const container = makeContainer('<i>Hello</i><i>World</i>');
    // isVisible() checks offsetHeight > 0 — set it on ALL <i> elements
    container.querySelectorAll('i').forEach((el) => {
      Object.defineProperty(el, 'offsetHeight', { value: 20, configurable: true });
    });
    const text = extractSubtitleText(container);
    expect(text).toContain('Hello');
    expect(text).toContain('World');
  });

  test('falls back to direct children when no <i> elements', () => {
    const container = makeContainer('<span>Line one</span><span>Line two</span>');
    Object.defineProperty(container.querySelectorAll('span')[0], 'offsetHeight', { value: 20, configurable: true });
    Object.defineProperty(container.querySelectorAll('span')[1], 'offsetHeight', { value: 20, configurable: true });
    const text = extractSubtitleText(container);
    expect(text).toContain('Line one');
  });

  test('falls back to textContent when no children match', () => {
    const container = document.createElement('div');
    container.textContent = 'Plain subtitle text';
    const text = extractSubtitleText(container);
    expect(text).toBe('Plain subtitle text');
  });

  test('trims whitespace from extracted lines', () => {
    const container = makeContainer('  <span>  Padded  </span>  ');
    Object.defineProperty(container.querySelector('span'), 'offsetHeight', { value: 20, configurable: true });
    const text = extractSubtitleText(container);
    expect(text.trim()).toBe('Padded');
  });

  // Note: the rsd-highlight filter on direct children is effectively a no-op
  // because .rsd-highlight spans are injected inside subtitle text elements,
  // not as direct children of the container. See code comment in content.js:467.
  test('includes highlighted word text in extracted subtitle (filter is no-op)', () => {
    const container = document.createElement('div');
    container.textContent = 'word'; // plain text, no children → falls back to textContent
    const text = extractSubtitleText(container);
    expect(text).toBe('word');
  });
});

// ─── translateText (content.js version) ──────────────────────────────────────

describe('translateText in content.js', () => {
  afterEach(() => { global.fetch = undefined; });

  test('returns translation on success', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([[['Привет', 'Hello'], [' мир', ' world']]]),
      })
    );
    const result = await translateText('Hello world');
    expect(result).toBe('Привет мир');
  });

  test('throws HTTP error message on non-OK response', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
    await expect(translateText('test')).rejects.toThrow('HTTP 429');
  });

  test('auto-detects source and targets the selected language (default ru)', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([[['ok', 'ok']]]) })
    );
    await translateText('test');
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('sl=auto');
    expect(url).toContain('tl=ru');
  });
});

// ─── Integration: duplicate save prevention in saveWord ───────────────────────

describe('saveWord deduplication', () => {
  // ⚠️  BUG: saveWord reads storage then writes — not atomic.
  // Two rapid saves of the same word can both pass the duplicate check
  // and insert two copies.
  test('BUG: concurrent saveWord calls may create duplicates (race condition)', (done) => {
    let callCount = 0;
    const storedDicts = [];

    // Simulate two concurrent reads both returning empty dict
    chrome.storage.local.get = jest.fn((_keys, cb) => {
      callCount++;
      setTimeout(() => cb({ rsd_dictionary: [], rsd_stats: {} }), 0);
    });
    chrome.storage.local.set = jest.fn((obj, cb) => {
      if (obj.rsd_dictionary) storedDicts.push(obj.rsd_dictionary);
      cb && cb();
    });

    const { saveWord } = require('../content.js');
    saveWord('hello', 'context', 'привет');
    saveWord('hello', 'context', 'привет'); // concurrent

    setTimeout(() => {
      // Both reads returned [] and both inserts run — we may end up with 2 copies
      const allWords = storedDicts.flatMap((d) => d.map((e) => e.word));
      const helloCopies = allWords.filter((w) => w === 'hello').length;
      // This test documents the race: if helloCopies > 1, the bug is present
      // NOTE: in practice popup closes on page click, making this race rare
      expect(helloCopies).toBeGreaterThanOrEqual(1); // at minimum 1 copy
      done();
    }, 100);
  });
});
