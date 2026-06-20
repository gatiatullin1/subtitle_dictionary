// Content script для hdrezka.ag
// Перехватывает клики на субтитрах, определяет слово через caretRangeFromPoint,
// показывает тултип с переводом. Не модифицирует DOM плеера.

(function () {
  let lastText = '';
  let observer = null;
  let observedNode = null;
  let searchInterval = null;
  let activeWord = null;
  let mutationDebounce = null;
  let clickAttached = false;

  // ─── Стили ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('rsd-styles')) return;
    const s = document.createElement('style');
    s.id = 'rsd-styles';
    s.textContent = `
      #pjs_cdnplayer_subtitle,
      #pjs_cdnplayer_subtitle * { cursor: pointer !important; }

      #rsd-tooltip {
        position: fixed;
        display: none;
        background: rgba(10,10,10,0.93);
        color: #fff;
        border-radius: 10px;
        padding: 12px 14px;
        z-index: 2147483647;
        min-width: 170px;
        max-width: 270px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.6);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        pointer-events: all;
      }
      #rsd-tooltip-word  { font-weight: 600; font-size: 16px; }
      #rsd-tooltip-transl { color: #7eb8ff; font-size: 13px; margin-top: 3px; min-height: 18px; }
      #rsd-tooltip-actions { display: flex; gap: 6px; margin-top: 10px; }
      #rsd-tooltip-add {
        flex: 1; background: #2563eb; color: #fff; border: none;
        border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer !important;
      }
      #rsd-tooltip-add:hover:not(:disabled) { background: #1d4ed8; }
      #rsd-tooltip-add:disabled { background: #3a7d44; cursor: default !important; }
      #rsd-tooltip-speak, #rsd-tooltip-close {
        background: rgba(255,255,255,0.1); color: #fff; border: none;
        border-radius: 6px; padding: 6px 9px; font-size: 12px; cursor: pointer !important;
      }
      #rsd-tooltip-speak:hover, #rsd-tooltip-close:hover { background: rgba(255,255,255,0.22); }
    `;
    document.head.appendChild(s);
  }

  // ─── Тултип ─────────────────────────────────────────────────────────────────
  function createTooltip() {
    if (document.getElementById('rsd-tooltip')) return;
    const div = document.createElement('div');
    div.id = 'rsd-tooltip';
    div.innerHTML = `
      <div id="rsd-tooltip-word"></div>
      <div id="rsd-tooltip-transl">...</div>
      <div id="rsd-tooltip-actions">
        <button id="rsd-tooltip-add">+ В словарь</button>
        <button id="rsd-tooltip-speak">🔊</button>
        <button id="rsd-tooltip-close">✕</button>
      </div>
    `;
    document.body.appendChild(div);

    div.querySelector('#rsd-tooltip-close').addEventListener('click', e => {
      e.stopPropagation();
      hideTooltip();
    });
    div.querySelector('#rsd-tooltip-speak').addEventListener('click', e => {
      e.stopPropagation();
      if (activeWord) speak(activeWord);
    });
    document.addEventListener('click', e => {
      const t = document.getElementById('rsd-tooltip');
      if (t && !t.contains(e.target)) hideTooltip();
    });
  }

  function hideTooltip() {
    const t = document.getElementById('rsd-tooltip');
    if (t) t.style.display = 'none';
    activeWord = null;
  }

  async function showTooltip(word, x, y, context) {
    activeWord = word;
    const tooltip = document.getElementById('rsd-tooltip');
    if (!tooltip) return;

    tooltip.querySelector('#rsd-tooltip-word').textContent = word;
    tooltip.querySelector('#rsd-tooltip-transl').textContent = '...';

    const addBtn = tooltip.querySelector('#rsd-tooltip-add');
    addBtn.textContent = '+ В словарь';
    addBtn.disabled = true;
    addBtn.onclick = null;

    tooltip.style.display = 'block';
    positionTooltip(tooltip, x, y);

    chrome.storage.local.get(['rsd_dictionary'], async res => {
      const dict = res.rsd_dictionary || [];
      const existing = dict.find(d => d.word.toLowerCase() === word.toLowerCase());

      if (existing) {
        tooltip.querySelector('#rsd-tooltip-transl').textContent = existing.translation;
        addBtn.textContent = '✓ В словаре';
        addBtn.disabled = true;
        return;
      }

      try {
        const translation = await translateWord(word);
        if (activeWord !== word) return;
        tooltip.querySelector('#rsd-tooltip-transl').textContent = translation;
        addBtn.disabled = false;
        addBtn.onclick = e => {
          e.stopPropagation();
          saveWord(word, context, translation);
          addBtn.textContent = '✓ Добавлено';
          addBtn.disabled = true;
        };
      } catch {
        tooltip.querySelector('#rsd-tooltip-transl').textContent = '(ошибка перевода)';
      }
    });
  }

  function positionTooltip(tooltip, x, y) {
    const tw = Math.max(tooltip.offsetWidth, 170);
    const th = Math.max(tooltip.offsetHeight, 80);
    // Показываем над курсором (субтитры обычно снизу)
    let top = y - th - 12;
    if (top < 10) top = y + 12;
    let left = x - tw / 2;
    if (left < 10) left = 10;
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  // ─── Определение слова под курсором ─────────────────────────────────────────
  function getWordAtPoint(x, y) {
    // caretRangeFromPoint — Chrome-only, для расширения подходит идеально
    const range = document.caretRangeFromPoint(x, y);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const text = range.startContainer.textContent;
    const pos = range.startOffset;

    let start = pos;
    let end = pos;
    while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z']/.test(text[end])) end++;

    const word = text.slice(start, end);
    return /[A-Za-z]/.test(word) ? word : null;
  }

  // ─── Субтитры ────────────────────────────────────────────────────────────────
  function isVisible(el) {
    let node = el;
    while (node && node !== document.body) {
      const st = window.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.01) return false;
      node = node.parentElement;
    }
    return el.offsetHeight > 0 || el.offsetWidth > 0;
  }

  function extractSubtitleText(node) {
    const italics = Array.from(node.querySelectorAll('i')).filter(el => isVisible(el) && el.textContent.trim());
    if (italics.length > 0) return italics.map(el => el.textContent.trim()).filter(Boolean).join('\n');

    const children = Array.from(node.children).filter(el => isVisible(el) && el.textContent.trim());
    if (children.length > 0) return children.map(el => el.textContent.trim()).filter(Boolean).join('\n');

    return node.textContent.trim();
  }

  function attachClickInterceptor(container) {
    if (clickAttached) return;
    clickAttached = true;
    container.addEventListener('click', e => {
      const word = getWordAtPoint(e.clientX, e.clientY);
      if (!word) return;
      e.stopPropagation();
      const context = extractSubtitleText(container);
      showTooltip(word, e.clientX, e.clientY, context);
    });
  }

  function handleMutation(container) {
    clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(() => {
      const text = extractSubtitleText(container);
      if (text && text !== lastText) {
        lastText = text;
        chrome.runtime.sendMessage({
          type: 'NEW_SUBTITLE_LINE',
          text, url: window.location.href, title: document.title, timestamp: Date.now()
        });
      }
    }, 250);
  }

  function attachObserver(container) {
    if (observer) observer.disconnect();
    observedNode = container;
    observer = new MutationObserver(() => handleMutation(container));
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    attachClickInterceptor(container);
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

  // ─── Утилиты ────────────────────────────────────────────────────────────────
  async function translateWord(word) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data[0].map(c => c[0]).join('');
  }

  function speak(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function saveWord(word, context, translation) {
    chrome.storage.local.get(['rsd_dictionary', 'rsd_stats'], res => {
      const dict = res.rsd_dictionary || [];
      if (dict.some(d => d.word.toLowerCase() === word.toLowerCase())) return;
      dict.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        word, translation, context,
        addedAt: Date.now(),
        interval: 0, repetitions: 0, easeFactor: 2.5, dueAt: Date.now()
      });
      const stats = res.rsd_stats || { wordsAdded: 0, reviewsDone: 0, linesTranslated: 0 };
      stats.wordsAdded = (stats.wordsAdded || 0) + 1;
      chrome.storage.local.set({ rsd_dictionary: dict, rsd_stats: stats });
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  injectStyles();
  createTooltip();
  startSearch();

  // SPA: если контейнер исчез из DOM — перезапускаем поиск
  setInterval(() => {
    if (observedNode && !document.contains(observedNode)) {
      observer && observer.disconnect();
      observer = null;
      observedNode = null;
      lastText = '';
      clickAttached = false;
      hideTooltip();
      startSearch();
    }
  }, 3000);
})();
