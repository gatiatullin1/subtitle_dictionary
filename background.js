// Background service worker
// Принимает строки субтитров от content script, хранит последние N штук в памяти
// и шлёт их popup при открытии

const MAX_HISTORY = 50;
let subtitleHistory = [];

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'NEW_SUBTITLE_LINE') {
    const entry = {
      id: `${message.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      text: message.text,
      url: message.url,
      pageTitle: message.title,
      timestamp: message.timestamp
    };
    subtitleHistory.unshift(entry);
    if (subtitleHistory.length > MAX_HISTORY) {
      subtitleHistory = subtitleHistory.slice(0, MAX_HISTORY);
    }
    // Сообщаем popup, если он сейчас открыт
    chrome.runtime.sendMessage({ type: 'HISTORY_UPDATED', history: subtitleHistory }).catch(() => {
      // popup закрыт — это нормально, просто никто не слушает
    });
  }

  if (message.type === 'GET_HISTORY') {
    return Promise.resolve({ history: subtitleHistory });
  }

  if (message.type === 'CLEAR_HISTORY') {
    subtitleHistory = [];
    return Promise.resolve({ ok: true });
  }
});
