// Content script для hdrezka.ag
// Следит за div#pjs_cdnplayer_subtitle и шлёт каждую новую строку в background

(function () {
  let lastText = '';
  let observer = null;
  let observedNode = null;
  let searchInterval = null;

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
  }

  function extractSubtitleText(node) {
    // Внутри контейнера текст лежит в <i> тегах, разделённых <br>
    // Фильтруем скрытые треки — берём только видимые <i>
    const italics = node.querySelectorAll('i');
    if (italics.length > 0) {
      const visible = Array.from(italics).filter(isVisible);
      if (visible.length > 0) {
        return visible.map((el) => el.textContent.trim()).filter(Boolean).join('\n');
      }
    }
    return node.textContent.trim();
  }

  function handleMutation(container) {
    const text = extractSubtitleText(container);
    if (text && text !== lastText) {
      lastText = text;
      chrome.runtime.sendMessage({
        type: 'NEW_SUBTITLE_LINE',
        text: text,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      });
    }
  }

  function attachObserver(container) {
    if (observer) observer.disconnect();
    observedNode = container;
    observer = new MutationObserver(() => handleMutation(container));
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
    handleMutation(container);
  }

  function findSubtitleContainer() {
    return document.querySelector('#pjs_cdnplayer_subtitle');
  }

  function startSearch() {
    if (searchInterval) clearInterval(searchInterval);
    searchInterval = setInterval(() => {
      const container = findSubtitleContainer();
      if (container) {
        attachObserver(container);
        clearInterval(searchInterval);
        searchInterval = null;
      }
    }, 1000);
  }

  startSearch();

  // SPA-навигация: проверяем, что НАБЛЮДАЕМЫЙ узел всё ещё в DOM.
  // document.contains(observedNode) — правильная проверка, т.к. мы следим
  // за конкретным узлом, а не ищем новый каждый раз.
  setInterval(() => {
    if (observedNode && !document.contains(observedNode)) {
      observer && observer.disconnect();
      observer = null;
      observedNode = null;
      lastText = '';
      startSearch();
    }
  }, 3000);
})();
