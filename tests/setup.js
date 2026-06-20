// Chrome Extension API mock
// Runs via setupFiles — jest framework globals (beforeEach, describe, etc.)
// are NOT available here. Only jest.fn() and jest.spyOn() work.

function makeStorage() {
  const store = {};
  return {
    _store: store,
    get: jest.fn((keys, cb) => {
      const result = {};
      const ks = Array.isArray(keys) ? keys : [keys];
      ks.forEach((k) => { if (k in store) result[k] = store[k]; });
      cb && cb(result);
    }),
    set: jest.fn((obj, cb) => {
      Object.assign(store, obj);
      cb && cb();
    }),
    _reset() { Object.keys(store).forEach((k) => delete store[k]); },
    _seed(obj) { Object.assign(store, obj); },
  };
}

global.chrome = {
  storage: {
    local: makeStorage(),
    sync: makeStorage(),
    session: makeStorage(),
  },
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: { addListener: jest.fn() },
    getManifest: jest.fn(() => ({ version: '1.2.0', name: 'Rezka Subtitle Dictionary' })),
    lastError: null,
  },
};

// Web Speech API
global.SpeechSynthesisUtterance = jest.fn((text) => ({ text, lang: '' }));
global.speechSynthesis = { cancel: jest.fn(), speak: jest.fn() };
