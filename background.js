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
