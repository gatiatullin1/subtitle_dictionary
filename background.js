// Background service worker
// Принимает строки субтитров от content script, хранит последние N штук
// в chrome.storage.session (переживает перезапуски SW, сбрасывается при закрытии браузера)

const MAX_HISTORY = 50;

function loadHistory() {
  return new Promise((resolve) => {
    chrome.storage.session.get(['subtitleHistory'], (res) => {
      resolve(res.subtitleHistory || []);
    });
  });
}

function saveHistory(history) {
  return chrome.storage.session.set({ subtitleHistory: history });
}

const _messageHandlers = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_SUBTITLE_LINE') {
    loadHistory().then(async (history) => {
      const entry = {
        id: `${message.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        text: message.text,
        url: message.url,
        pageTitle: message.title,
        timestamp: message.timestamp
      };
      history.unshift(entry);
      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }
      await saveHistory(history);
      chrome.runtime.sendMessage({ type: 'HISTORY_UPDATED', history }).catch(() => {});
    });
    return false;
  }

  if (message.type === 'GET_HISTORY') {
    loadHistory().then((history) => sendResponse({ history }));
    return true;
  }

  if (message.type === 'CLEAR_HISTORY') {
    saveHistory([]).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'CHECK_UPDATE') {
    // Пробуем jsDelivr (CDN, не блокируется), потом raw.githubusercontent.com
    const urls = [
      'https://cdn.jsdelivr.net/gh/gatiatullin1/subtitle_dictionary@main/manifest.json',
      'https://raw.githubusercontent.com/gatiatullin1/subtitle_dictionary/main/manifest.json'
    ];
    (async () => {
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const data = await res.json();
          if (data.version) {
            sendResponse({ ok: true, version: data.version });
            return;
          }
        } catch {}
      }
      sendResponse({ ok: false });
    })();
    return true;
  }
});

// ===== Резервное копирование словаря в chrome.storage.sync =====
// storage.local очищается при удалении расширения. storage.sync переживает
// reload/обновление версии и (в большинстве случаев) переустановку в том же
// профиле Chrome. Для гарантии при полном удалении — Экспорт/Импорт в попапе.
//
// Здесь — ЕДИНСТВЕННАЯ точка бэкапа: onChanged ловит запись словаря откуда угодно
// (и из content.js, и из popup.js), поэтому ни одно слово не теряется.

const SYNC_CHUNK = 7000; // байт на ключ (лимит 8192)
let _backupTimer = null;

function backupDictionaryToSync(dict) {
  try {
    const json = JSON.stringify(dict || []);
    const data = {};
    let n = 0;
    for (let i = 0; i < json.length; i += SYNC_CHUNK, n++) {
      data['rsd_bak_' + n] = json.slice(i, i + SYNC_CHUNK);
    }
    data.rsd_bak_n = n;
    // Чистим устаревшие чанки (если словарь стал короче), затем пишем новые
    chrome.storage.sync.get(null, (all) => {
      const stale = Object.keys(all || {})
        .filter((k) => /^rsd_bak_\d+$/.test(k) && Number(k.slice(8)) >= n);
      const write = () => chrome.storage.sync.set(data, () => void chrome.runtime.lastError);
      if (stale.length) chrome.storage.sync.remove(stale, write);
      else write();
    });
  } catch (e) { /* quota / sync недоступен — не критично */ }
}

function restoreDictionaryFromSync() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('rsd_bak_n', (res) => {
      const n = (res && res.rsd_bak_n) || 0;
      if (!n) return resolve([]);
      const keys = Array.from({ length: n }, (_, i) => 'rsd_bak_' + i);
      chrome.storage.sync.get(keys, (res2) => {
        try { resolve(JSON.parse(keys.map((k) => (res2 && res2[k]) || '').join('')) || []); }
        catch { resolve([]); }
      });
    });
  });
}

function getLocalDict() {
  return new Promise((resolve) => {
    chrome.storage.local.get('rsd_dictionary', (res) => resolve((res && res.rsd_dictionary) || []));
  });
}

// Любое изменение словаря (из content.js или popup.js) зеркалируем в sync.
// Небольшой дебаунс, чтобы серия добавлений слилась в одну запись (экономим квоту sync).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.rsd_dictionary) return;
  const dict = changes.rsd_dictionary.newValue || [];
  clearTimeout(_backupTimer);
  _backupTimer = setTimeout(() => backupDictionaryToSync(dict), 1000);
});

// При установке / обновлении / перезагрузке расширения:
//  - если local пуст, а в sync есть бэкап → восстанавливаем;
//  - если в local уже есть слова → освежаем бэкап (важно для первого запуска
//    после этого обновления, когда онго данные ещё не в sync).
chrome.runtime.onInstalled.addListener(async () => {
  const local = await getLocalDict();
  if (local.length === 0) {
    const backup = await restoreDictionaryFromSync();
    if (backup.length) chrome.storage.local.set({ rsd_dictionary: backup });
  } else {
    backupDictionaryToSync(local);
  }
});

// ===== Test exports (Node.js only) =====
if (typeof module !== 'undefined') {
  module.exports = {
    loadHistory,
    saveHistory,
    MAX_HISTORY,
    backupDictionaryToSync,
    restoreDictionaryFromSync,
  };
}
