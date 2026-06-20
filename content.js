// Content script для hdrezka.ag
// Следит за div#pjs_cdnplayer_subtitle и шлёт каждую новую строку в background

(function () {
  let lastText = '';
  let observer = null;
  let searchInterval = null;

  function extractSubtitleText(node) {
    // Внутри контейнера текст лежит в <i> тегах, разделённых <br>
    // Если <i> нет — берём textContent как запасной вариант
    const italics = node.querySelectorAll('i');
    if (italics.length > 0) {
      return Array.from(italics)
        .map((el) => el.textContent.trim())
        .filter(Boolean)
        .join('\n');
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
    observer = new MutationObserver(() => handleMutation(container));
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
    // Захватываем то, что уже видно на экране в момент подключения
    handleMutation(container);
  }

  function findSubtitleContainer() {
    return document.querySelector('#pjs_cdnplayer_subtitle');
  }

  // Контейнер субтитров появляется в DOM не сразу (плеер подгружается асинхронно),
  // поэтому опрашиваем страницу, пока не найдём его
  searchInterval = setInterval(() => {
    const container = findSubtitleContainer();
    if (container) {
      attachObserver(container);
      clearInterval(searchInterval);
    }
  }, 1000);

  // Если SPA-навигация на rezka подменяет плеер без перезагрузки страницы —
  // на случай "потери" контейнера ищем его заново
  setInterval(() => {
    const container = findSubtitleContainer();
    if (container && observer) {
      // переподключаемся, если наблюдаемый узел больше не в DOM
      if (!document.contains(container)) {
        attachObserver(container);
      }
    } else if (container && !observer) {
      attachObserver(container);
    }
  }, 3000);
})();
