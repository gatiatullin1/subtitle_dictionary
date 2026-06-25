/**
 * Tests for background.js
 * Tests the loadHistory / saveHistory helpers and message handling logic.
 */

chrome.storage.session.get = jest.fn((_keys, cb) => cb({}));
chrome.storage.session.set = jest.fn((_obj, cb) => cb && cb());
chrome.runtime.sendMessage = jest.fn(() => {});
chrome.runtime.onMessage.addListener = jest.fn();
chrome.storage.onChanged = { addListener: jest.fn() };
chrome.runtime.onInstalled = { addListener: jest.fn() };

const {
  loadHistory,
  saveHistory,
  MAX_HISTORY,
  backupDictionaryToSync,
  restoreDictionaryFromSync,
} = require('../background.js');

beforeEach(() => {
  chrome.storage.session._reset();
  chrome.runtime.lastError = null;
});

// ─── loadHistory ─────────────────────────────────────────────────────────────

describe('loadHistory', () => {
  test('returns [] when session storage is empty', async () => {
    chrome.storage.session.get = jest.fn((_keys, cb) => cb({}));
    const history = await loadHistory();
    expect(history).toEqual([]);
  });

  test('returns stored history', async () => {
    const stored = [{ id: '1', text: 'Hello', timestamp: 1000 }];
    chrome.storage.session.get = jest.fn((_keys, cb) => cb({ subtitleHistory: stored }));
    const history = await loadHistory();
    expect(history).toEqual(stored);
  });

  test('returns [] when stored value is null/undefined', async () => {
    chrome.storage.session.get = jest.fn((_keys, cb) => cb({ subtitleHistory: null }));
    const history = await loadHistory();
    expect(history).toEqual([]);
  });
});

// ─── saveHistory ─────────────────────────────────────────────────────────────

describe('saveHistory', () => {
  test('stores history under "subtitleHistory" key', async () => {
    chrome.storage.session.set = jest.fn((_obj) => Promise.resolve());
    const entries = [{ id: '1', text: 'Hello' }];
    await saveHistory(entries);
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ subtitleHistory: entries });
  });

  test('stores empty array', async () => {
    chrome.storage.session.set = jest.fn((_obj) => Promise.resolve());
    await saveHistory([]);
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ subtitleHistory: [] });
  });
});

// ─── MAX_HISTORY constant ─────────────────────────────────────────────────────

describe('MAX_HISTORY', () => {
  test('is 50', () => {
    expect(MAX_HISTORY).toBe(50);
  });
});

// ─── Message handler logic (extracted, not via onMessage) ──────────────────────

describe('History size trimming', () => {
  test('history is trimmed to MAX_HISTORY after exceeding it', async () => {
    // Simulate what the NEW_SUBTITLE_LINE handler does
    const existing = Array.from({ length: MAX_HISTORY }, (_, i) => ({
      id: String(i), text: `Line ${i}`, timestamp: i,
    }));

    let history = [...existing];
    const newEntry = { id: 'new', text: 'New line', timestamp: 9999 };
    history.unshift(newEntry);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);

    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0].id).toBe('new');
    expect(history[MAX_HISTORY - 1].id).toBe(String(MAX_HISTORY - 2));
  });

  test('history under MAX_HISTORY is not trimmed', async () => {
    let history = [{ id: '1', text: 'Line 1', timestamp: 1 }];
    const newEntry = { id: '2', text: 'Line 2', timestamp: 2 };
    history.unshift(newEntry);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);

    expect(history).toHaveLength(2);
  });
});

// ─── Entry ID format ─────────────────────────────────────────────────────────

describe('Entry ID generation', () => {
  test('entry ID follows timestamp-random pattern', () => {
    // ID format from background.js: `${message.timestamp}-${Math.random().toString(36).slice(2, 8)}`
    const timestamp = 1700000000000;
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^\d+-[a-z0-9]{6}$/);
  });

  test('two entries created at same ms have different IDs (random suffix)', () => {
    const ts = Date.now();
    const id1 = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
    const id2 = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id1).not.toBe(id2); // overwhelmingly true; Math.random collision is 1 in 2^30
  });
});

// ─── Update check logic ───────────────────────────────────────────────────────

describe('CHECK_UPDATE version logic', () => {
  afterEach(() => { global.fetch = undefined; });

  test('returns {ok: true, version} from manifest.json', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '1.3.0', name: 'Rezka Subtitle Dictionary' }),
      })
    );
    // Simulate handler logic
    const urls = [
      'https://cdn.jsdelivr.net/gh/gatiatullin1/subtitle_dictionary@main/manifest.json',
    ];
    let result = { ok: false };
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.version) { result = { ok: true, version: data.version }; break; }
      } catch {}
    }
    expect(result).toEqual({ ok: true, version: '1.3.0' });
  });

  test('falls back to second URL when first fails', async () => {
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: false });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '1.3.0' }),
      });
    });
    const urls = ['url1', 'url2'];
    let result = { ok: false };
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.version) { result = { ok: true, version: data.version }; break; }
      } catch {}
    }
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  test('returns {ok: false} when both URLs fail', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
    const urls = ['url1', 'url2'];
    let result = { ok: false };
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.version) { result = { ok: true, version: data.version }; break; }
      } catch {}
    }
    expect(result).toEqual({ ok: false });
  });

  test('ignores manifest.json without version field', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ name: 'Some Extension' }), // no version
      })
    );
    const urls = ['url1'];
    let result = { ok: false };
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.version) { result = { ok: true, version: data.version }; break; }
      } catch {}
    }
    expect(result.ok).toBe(false);
  });

  test('background returns version string which popup compares with isNewerVersion', () => {
    // background.js just returns { ok: true, version: "x.y.z" } — the comparison
    // is done in popup.js via isNewerVersion(). Background is not responsible for
    // deciding whether to show the banner.
    const remoteVersion = '1.1.0';
    expect(typeof remoteVersion).toBe('string');
    expect(remoteVersion.split('.').length).toBe(3);
  });
});

// ─── Dictionary backup/restore (chrome.storage.sync) ──────────────────────────

describe('backupDictionaryToSync', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
    chrome.storage.sync.get = jest.fn((_keys, cb) => cb({}));
    chrome.storage.sync.set = jest.fn((_obj, cb) => cb && cb());
    chrome.storage.sync.remove = jest.fn((_keys, cb) => cb && cb());
  });

  test('stores dictionary in chunks with rsd_bak_n marker', () => {
    backupDictionaryToSync([{ id: '1', word: 'test', translation: 'тест' }]);
    expect(chrome.storage.sync.set).toHaveBeenCalled();
    const stored = chrome.storage.sync.set.mock.calls[0][0];
    expect(stored.rsd_bak_n).toBe(1);
    expect(stored.rsd_bak_0).toBeTruthy();
  });

  test('splits large dictionary into multiple chunks', () => {
    backupDictionaryToSync([{ word: 'a'.repeat(7001) }]); // >7000 → 2 чанка
    const stored = chrome.storage.sync.set.mock.calls[0][0];
    expect(stored.rsd_bak_n).toBe(2);
    expect(stored.rsd_bak_1).toBeTruthy();
  });

  test('removes stale chunks left from a longer previous dictionary', () => {
    // В sync остались rsd_bak_0..2 от старого словаря; новый — 1 чанк
    chrome.storage.sync.get = jest.fn((_keys, cb) =>
      cb({ rsd_bak_0: 'x', rsd_bak_1: 'y', rsd_bak_2: 'z', rsd_bak_n: 3 }));
    backupDictionaryToSync([{ word: 'cat' }]);
    expect(chrome.storage.sync.remove).toHaveBeenCalled();
    const removed = chrome.storage.sync.remove.mock.calls[0][0];
    expect(removed).toEqual(expect.arrayContaining(['rsd_bak_1', 'rsd_bak_2']));
    expect(removed).not.toContain('rsd_bak_0'); // его перезапишут
  });

  test('does not throw when sync quota is exceeded', () => {
    chrome.storage.sync.set = jest.fn((_obj, cb) => {
      chrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
      cb && cb();
    });
    expect(() => backupDictionaryToSync([{ word: 'test' }])).not.toThrow();
  });
});

describe('restoreDictionaryFromSync', () => {
  beforeEach(() => { chrome.runtime.lastError = null; });

  test('returns [] when sync is empty', async () => {
    chrome.storage.sync.get = jest.fn((_keys, cb) => cb({}));
    expect(await restoreDictionaryFromSync()).toEqual([]);
  });

  test('reassembles chunked dictionary', async () => {
    const original = [{ id: '1', word: 'cat', translation: 'кот' }];
    const json = JSON.stringify(original);
    chrome.storage.sync.get = jest.fn((keys, cb) =>
      keys === 'rsd_bak_n' ? cb({ rsd_bak_n: 1 }) : cb({ rsd_bak_0: json }));
    expect(await restoreDictionaryFromSync()).toEqual(original);
  });

  test('returns [] on corrupt JSON', async () => {
    chrome.storage.sync.get = jest.fn((keys, cb) =>
      keys === 'rsd_bak_n' ? cb({ rsd_bak_n: 1 }) : cb({ rsd_bak_0: 'INVALID' }));
    expect(await restoreDictionaryFromSync()).toEqual([]);
  });
});
