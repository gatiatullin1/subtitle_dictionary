// Content script для hdrezka.ag
(function () {
  let observer      = null;
  let observedNode  = null;
  let searchInterval = null;
  let mutationDebounce = null;
  let lastText      = '';
  let clickAttached = false;

  // Мультивыбор слов
  let selectedWords = [];
  let fetchId       = 0;
  let lastContext   = '';

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
        background: rgba(10,10,10,0.95);
        color: #fff;
        border-radius: 10px;
        padding: 12px 14px;
        z-index: 2147483647;
        min-width: 180px;
        max-width: 290px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.6);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        pointer-events: all;
      }
      #rsd-tooltip-words {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 6px;
      }
      .rsd-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(255,255,255,0.15);
        border-radius: 5px;
        padding: 2px 7px 2px 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .rsd-pill:hover { background: rgba(255,255,255,0.27); }
      .rsd-pill-x {
        font-size: 11px;
        opacity: 0.55;
        line-height: 1;
        cursor: pointer;
      }
      .rsd-pill-x:hover { opacity: 1; }
      #rsd-tooltip-hint {
        font-size: 11px;
        color: rgba(255,255,255,0.4);
        margin-bottom: 4px;
      }
      #rsd-tooltip-transl {
        color: #7eb8ff;
        font-size: 13px;
        min-height: 18px;
        margin-bottom: 2px;
      }
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
      <div id="rsd-tooltip-words"></div>
      <div id="rsd-tooltip-hint">ещё клик — добавить слово к фразе</div>
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
      if (selectedWords.length) speak(selectedWords.join(' '));
    });
    document.addEventListener('click', e => {
      const t = document.getElementById('rsd-tooltip');
      if (t && t.style.display !== 'none' && !t.contains(e.target)) hideTooltip();
    });
  }

  function hideTooltip() {
    const t = document.getElementById('rsd-tooltip');
    if (t) t.style.display = 'none';
    selectedWords = [];
    fetchId++;
  }

  // ─── Логика мультивыбора ─────────────────────────────────────────────────────
  function toggleWord(word, x, y, context) {
    lastContext = context;
    const lc = word.toLowerCase();
    const idx = selectedWords.findIndex(w => w.toLowerCase() === lc);
    if (idx !== -1) {
      selectedWords.splice(idx, 1);
    } else {
      selectedWords.push(word);
    }

    if (selectedWords.length === 0) {
      hideTooltip();
      return;
    }

    const tooltip = document.getElementById('rsd-tooltip');
    if (!tooltip) return;

    // Показываем тултип; позиционируем только при первом открытии
    if (tooltip.style.display === 'none') {
      tooltip.style.display = 'block';
      positionTooltip(tooltip, x, y);
    } else {
      tooltip.style.display = 'block';
    }

    renderPills();
    startTranslation();
  }

  function renderPills() {
    const wordsEl = document.getElementById('rsd-tooltip-words');
    if (!wordsEl) return;
    wordsEl.innerHTML = '';
    selectedWords.forEach(w => {
      const pill = document.createElement('span');
      pill.className = 'rsd-pill';
      pill.innerHTML = `${w} <span class="rsd-pill-x">✕</span>`;
      pill.querySelector('.rsd-pill-x').addEventListener('click', e => {
        e.stopPropagation();
        const lc = w.toLowerCase();
        selectedWords = selectedWords.filter(sw => sw.toLowerCase() !== lc);
        if (selectedWords.length === 0) { hideTooltip(); return; }
        renderPills();
        startTranslation();
      });
      wordsEl.appendChild(pill);
    });

    const hint = document.getElementById('rsd-tooltip-hint');
    if (hint) hint.style.display = selectedWords.length > 0 ? 'block' : 'none';
  }

  async function startTranslation() {
    const myId = ++fetchId;
    const phrase = selectedWords.join(' ');

    const transl = document.getElementById('rsd-tooltip-transl');
    const addBtn = document.getElementById('rsd-tooltip-add');
    if (!transl || !addBtn) return;

    transl.textContent = '...';
    addBtn.textContent = '+ В словарь';
    addBtn.disabled = true;
    addBtn.onclick = null;

    // Для одиночного слова проверяем словарь
    if (selectedWords.length === 1) {
      const dictEntry = await getFromDict(selectedWords[0]);
      if (myId !== fetchId) return;
      if (dictEntry) {
        transl.textContent = dictEntry.translation;
        addBtn.textContent = '✓ В словаре';
        addBtn.disabled = true;
        return;
      }
    }

    // Переводим фразу
    try {
      const translation = await translateText(phrase);
      if (myId !== fetchId) return;
      transl.textContent = translation;
      addBtn.disabled = false;
      addBtn.onclick = e => {
        e.stopPropagation();
        saveWord(phrase, lastContext, translation);
        addBtn.textContent = '✓ Добавлено';
        addBtn.disabled = true;
      };
    } catch {
      if (myId !== fetchId) return;
      transl.textContent = '(ошибка перевода)';
    }
  }

  function getFromDict(word) {
    return new Promise(resolve => {
      chrome.storage.local.get(['rsd_dictionary'], res => {
        const dict = res.rsd_dictionary || [];
        resolve(dict.find(d => d.word.toLowerCase() === word.toLowerCase()) || null);
      });
    });
  }

  function positionTooltip(tooltip, x, y) {
    const tw = Math.max(tooltip.offsetWidth, 180);
    const th = Math.max(tooltip.offsetHeight, 90);
    let top = y - th - 12;
    if (top < 10) top = y + 12;
    let left = x - tw / 2;
    if (left < 10) left = 10;
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    tooltip.style.top  = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  // ─── Определение слова под курсором ─────────────────────────────────────────
  function getWordAtPoint(x, y) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;

    let node = range.startContainer;
    let pos  = range.startOffset;

    if (node.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode) return null;
      node = textNode;
      pos  = 0;
    }

    return wordNear(node.textContent, pos);
  }

  function wordNear(text, pos) {
    const safe = Math.min(Math.max(pos, 0), text.length);
    for (let d = 0; d <= 5; d++) {
      for (const p of (d === 0 ? [safe] : [safe - d, safe + d])) {
        if (p < 0 || p >= text.length) continue;
        if (!/[A-Za-z']/.test(text[p])) continue;
        let s = p, e = p;
        while (s > 0 && /[A-Za-z']/.test(text[s - 1])) s--;
        while (e < text.length && /[A-Za-z']/.test(text[e])) e++;
        const word = text.slice(s, e);
        if (/[A-Za-z]/.test(word)) return word;
      }
    }
    return null;
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
      toggleWord(word, e.clientX, e.clientY, context);
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

  function startSearch() {
    if (searchInterval) clearInterval(searchInterval);
    searchInterval = setInterval(() => {
      const container = document.querySelector('#pjs_cdnplayer_subtitle');
      if (container) {
        attachObserver(container);
        clearInterval(searchInterval);
        searchInterval = null;
      }
    }, 1000);
  }

  // ─── Утилиты ────────────────────────────────────────────────────────────────
  async function translateText(text) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
