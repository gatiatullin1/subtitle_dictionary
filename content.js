// Content script для hdrezka.ag
// Делает слова в субтитрах кликабельными прямо на видео

(function () {
  let lastText = '';
  let observer = null;
  let observedNode = null;
  let searchInterval = null;
  let activeWord = null;   // слово в открытом тултипе

  // ─── Стили, инжектируемые на страницу ───────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('rsd-styles')) return;
    const s = document.createElement('style');
    s.id = 'rsd-styles';
    s.textContent = `
      .rsd-word {
        cursor: pointer;
        border-radius: 2px;
        padding: 0 1px;
        border-bottom: 1px dashed rgba(255,255,255,0.55);
        transition: background 0.1s;
      }
      .rsd-word:hover { background: rgba(255,210,0,0.35); }
      .rsd-word.rsd-in-dict {
        background: rgba(82,183,136,0.25);
        border-bottom-color: #52b788;
      }

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
        border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer;
      }
      #rsd-tooltip-add:hover:not(:disabled) { background: #1d4ed8; }
      #rsd-tooltip-add:disabled { background: #3a7d44; cursor: default; }
      #rsd-tooltip-speak, #rsd-tooltip-close {
        background: rgba(255,255,255,0.1); color: #fff; border: none;
        border-radius: 6px; padding: 6px 9px; font-size: 12px; cursor: pointer;
      }
      #rsd-tooltip-speak:hover, #rsd-tooltip-close:hover {
        background: rgba(255,255,255,0.22);
      }
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

    div.querySelector('#rsd-tooltip-close').addEventListener('click', (e) => {
      e.stopPropagation();
      hideTooltip();
    });
    div.querySelector('#rsd-tooltip-speak').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeWord) speak(activeWord);
    });

    document.addEventListener('click', (e) => {
      const t = document.getElementById('rsd-tooltip');
      if (t && !t.contains(e.target) && !e.target.classList.contains('rsd-word')) {
        hideTooltip();
      }
    });
  }

  function hideTooltip() {
    const t = document.getElementById('rsd-tooltip');
    if (t) t.style.display = 'none';
    activeWord = null;
  }

  function positionTooltip(tooltip, anchor) {
    const r = anchor.getBoundingClientRect();
    const tw = Math.max(tooltip.offsetWidth, 170);
    const th = Math.max(tooltip.offsetHeight, 80);
    // показываем над словом (субтитры обычно снизу)
    let top = r.top - th - 10;
    if (top < 10) top = r.bottom + 10;
    let left = r.left + r.width / 2 - tw / 2;
    if (left < 10) left = 10;
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  async function showTooltip(word, anchorEl, context) {
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
    positionTooltip(tooltip, anchorEl);

    chrome.storage.local.get(['rsd_dictionary'], async (res) => {
      const dict = res.rsd_dictionary || [];
      const existing = dict.find((d) => d.word.toLowerCase() === word.toLowerCase());

      if (existing) {
        tooltip.querySelector('#rsd-tooltip-transl').textContent = existing.translation;
        addBtn.textContent = '✓ В словаре';
        addBtn.disabled = true;
        return;
      }

      try {
        const translation = await translateWord(word);
        if (activeWord !== word) return; // тултип уже сменился
        tooltip.querySelector('#rsd-tooltip-transl').textContent = translation;
        addBtn.disabled = false;
        addBtn.onclick = (e) => {
          e.stopPropagation();
          saveWord(word, context, translation);
          addBtn.textContent = '✓ Добавлено';
          addBtn.disabled = true;
          // подсвечиваем все вхождения этого слова как сохранённые
          document.querySelectorAll(`.rsd-word[data-word="${CSS.escape(word)}"]`)
            .forEach((s) => s.classList.add('rsd-in-dict'));
        };
      } catch {
        tooltip.querySelector('#rsd-tooltip-transl').textContent = '(ошибка перевода)';
      }
    });
  }

  // ─── Утилиты ────────────────────────────────────────────────────────────────
  async function translateWord(word) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data[0].map((c) => c[0]).join('');
  }

  function speak(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function saveWord(word, context, translation) {
    chrome.storage.local.get(['rsd_dictionary', 'rsd_stats'], (res) => {
      const dict = res.rsd_dictionary || [];
      if (dict.some((d) => d.word.toLowerCase() === word.toLowerCase())) return;
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

  // ─── Субтитры ────────────────────────────────────────────────────────────────
  function isVisible(el) {
    const st = window.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0;
  }

  function extractSubtitleText(node) {
    const italics = node.querySelectorAll('i');
    if (italics.length > 0) {
      const visible = Array.from(italics).filter(isVisible);
      if (visible.length > 0) {
        return visible.map((el) => el.textContent.trim()).filter(Boolean).join('\n');
      }
    }
    return node.textContent.trim();
  }

  function wrapWordsInContainer(container) {
    // Отключаем наблюдатель, чтобы не создавать петлю при изменении DOM
    if (observer) observer.disconnect();

    const italics = Array.from(container.querySelectorAll('i')).filter(isVisible);
    const context = italics.map((i) => i.textContent.trim()).join(' ');

    italics.forEach((el) => {
      el.innerHTML = el.textContent.replace(/[A-Za-z']+/g, (word) => {
        return `<span class="rsd-word" data-word="${word}">${word}</span>`;
      });
    });

    // Вешаем клики на слова
    container.querySelectorAll('.rsd-word').forEach((span) => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        showTooltip(span.dataset.word, span, context);
      });
    });

    // Подсвечиваем уже сохранённые слова
    chrome.storage.local.get(['rsd_dictionary'], (res) => {
      const dict = res.rsd_dictionary || [];
      const known = new Set(dict.map((d) => d.word.toLowerCase()));
      container.querySelectorAll('.rsd-word').forEach((span) => {
        if (known.has(span.dataset.word.toLowerCase())) {
          span.classList.add('rsd-in-dict');
        }
      });
    });

    // Переподключаем наблюдатель
    if (observer) {
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }
  }

  function handleMutation(container) {
    const text = extractSubtitleText(container);
    if (text && text !== lastText) {
      lastText = text;
      chrome.runtime.sendMessage({
        type: 'NEW_SUBTITLE_LINE',
        text, url: window.location.href, title: document.title, timestamp: Date.now()
      });
      wrapWordsInContainer(container);
    }
  }

  function attachObserver(container) {
    if (observer) observer.disconnect();
    observedNode = container;
    observer = new MutationObserver(() => handleMutation(container));
    observer.observe(container, { childList: true, subtree: true, characterData: true });
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

  injectStyles();
  createTooltip();
  startSearch();

  // SPA: если наблюдаемый узел исчез из DOM — перезапускаем поиск
  setInterval(() => {
    if (observedNode && !document.contains(observedNode)) {
      observer && observer.disconnect();
      observer = null;
      observedNode = null;
      lastText = '';
      hideTooltip();
      startSearch();
    }
  }, 3000);
})();
