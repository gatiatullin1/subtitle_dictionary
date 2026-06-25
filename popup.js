// ===== Storage helpers =====
const STORE_KEYS = {
  DICTIONARY: 'rsd_dictionary',
  STATS: 'rsd_stats'
};

function storageGet(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      resolve(res[key] !== undefined ? res[key] : fallback);
    });
  });
}

function storageSet(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

// ===== Translation (Google Translate public endpoint, no key) =====
async function translateText(text, targetLang = 'ru', sourceLang = 'en') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Translate request failed');
  const data = await res.json();
  // Формат ответа: [[["перевод","оригинал",...], ...], ...]
  return data[0].map((chunk) => chunk[0]).join('');
}

// ===== Tabs =====
function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'dictionary') {
        storageGet(STORE_KEYS.DICTIONARY, []).then((d) => { dictionary = d; renderDictionary(); });
      }
      if (btn.dataset.tab === 'practice') renderPractice();
      if (btn.dataset.tab === 'stats') renderStats();
    });
  });
}

// ===== Word tooltip =====
let subtitleHistory = [];
let dictionary = [];
let collapsedSources = new Set(); // URL источников, свёрнутых в аккордеоне

let tooltipEl = null;
let tooltipOutsideHandler = null;

function getTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'word-tooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function hideTooltip() {
  const t = getTooltip();
  t.style.display = 'none';
  if (tooltipOutsideHandler) {
    document.removeEventListener('click', tooltipOutsideHandler);
    tooltipOutsideHandler = null;
  }
}

async function showWordTooltip(span, word, context, source = null) {
  hideTooltip();
  const tooltip = getTooltip();
  const known = dictionary.find((d) => d.word.toLowerCase() === word.toLowerCase());

  tooltip.innerHTML = `
    <div class="word-tooltip-word">${escapeHtml(word)}</div>
    <div class="word-tooltip-transl">${known ? escapeHtml(known.translation) : '...'}</div>
    <div class="word-tooltip-actions">
      <button class="word-tooltip-add"${known ? ' disabled' : ''}>${known ? '✓ В словаре' : '+ В словарь'}</button>
      <button class="word-tooltip-speak">🔊</button>
      <button class="word-tooltip-close">✕</button>
    </div>
  `;
  tooltip.style.display = 'block';

  // Позиционируем под словом, не выходя за границы попапа
  const rect = span.getBoundingClientRect();
  const tipW = 200;
  let left = rect.left;
  if (left + tipW > window.innerWidth - 6) left = window.innerWidth - tipW - 6;
  if (left < 6) left = 6;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${rect.bottom + 4}px`;

  const translEl = tooltip.querySelector('.word-tooltip-transl');
  const addBtn = tooltip.querySelector('.word-tooltip-add');

  tooltip.querySelector('.word-tooltip-speak').addEventListener('click', (e) => {
    e.stopPropagation();
    speak(word);
  });
  tooltip.querySelector('.word-tooltip-close').addEventListener('click', (e) => {
    e.stopPropagation();
    hideTooltip();
  });

  let fetchedTranslation = known ? known.translation : null;

  if (!known) {
    try {
      fetchedTranslation = await translateText(word);
      if (tooltip.style.display !== 'none') translEl.textContent = fetchedTranslation;
    } catch {
      if (tooltip.style.display !== 'none') translEl.textContent = '(ошибка перевода)';
    }

    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await addWordToDictionary(word, context, fetchedTranslation, source);
      addBtn.textContent = '✓ Добавлено';
      addBtn.disabled = true;
      renderSubtitleList();
    });
  }

  // Закрыть при клике вне тултипа
  setTimeout(() => {
    tooltipOutsideHandler = (e) => {
      if (!tooltip.contains(e.target)) hideTooltip();
    };
    document.addEventListener('click', tooltipOutsideHandler);
  }, 0);
}

// ===== Source names (переименование) =====
// Хранятся в localStorage: { [url]: customName }
function getSourceNames() {
  try { return JSON.parse(localStorage.getItem('rsd_source_names') || '{}'); } catch { return {}; }
}
function setSourceName(url, name) {
  const names = getSourceNames();
  if (name) names[url] = name; else delete names[url];
  localStorage.setItem('rsd_source_names', JSON.stringify(names));
}
function getSourceDisplayName(url, fallback) {
  if (!url) return fallback || 'Без источника';
  const names = getSourceNames();
  return names[url] || fallback || 'Без источника';
}

function promptRenameSource(url, currentName) {
  const newName = window.prompt(`Переименовать «${currentName}»:`, currentName);
  if (newName === null) return; // отмена
  setSourceName(url, newName.trim() || '');
  renderDictionary(document.getElementById('dict-search')?.value || '');
}

// ===== Source filter =====

function extractCleanTitle(raw) {
  if (!raw) return '';
  let t = raw;
  t = t.replace(/\s*[-–|]\s*(?:hd)?rezka[\.\w]*/gi, '');
  t = t.replace(/\s+(?:hd)?rezka\.\w+\s*$/i, '');
  t = t.replace(/\s*смотреть.*/i, '');
  t = t.replace(/\s*watch.*/i, '');
  t = t.replace(/\s*онлайн.*/i, '');
  t = t.replace(/\s*бесплатно.*/i, '');
  // Год оставляем в заголовке: "(2015)", "(2015-2022)"
  return t.trim();
}

// renderSourceFilter удалён — заменён аккордеоном в renderDictionary

// ===== Subtitles list =====

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function wrapWordsClickable(rawLine) {
  // Split on word boundaries: odd indices are words, even indices are non-word text.
  // Non-word parts are HTML-escaped; words are wrapped in clickable spans.
  // Accepts RAW text — do not pre-escape before calling this function.
  return rawLine.split(/([A-Za-zÀ-ÖØ-öø-ÿ']+)/).map((part, i) => {
    if (i % 2 === 0) return escapeHtml(part);
    const isKnown = dictionary.some((d) => d.word.toLowerCase() === part.toLowerCase());
    const cls = isKnown ? 'word in-dict' : 'word';
    return `<span class="${cls}" data-word="${escapeHtml(part)}">${escapeHtml(part)}</span>`;
  }).join('');
}

function renderSubtitleList() {
  const container = document.getElementById('subtitle-list');
  if (subtitleHistory.length === 0) {
    container.innerHTML = '<p class="empty-state">Открой видео с субтитрами на rezka — строки появятся здесь.</p>';
    return;
  }

  container.innerHTML = subtitleHistory
    .map((entry) => {
      const lines = entry.text.split('\n');
      const htmlLines = lines.map((l) => wrapWordsClickable(l)).join('<br>');
      const translationBlock = entry.translation
        ? `<div class="subtitle-translation">${escapeHtml(entry.translation)}</div>`
        : '';
      const time = new Date(entry.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `
        <div class="subtitle-card" data-id="${entry.id}">
          <div class="subtitle-original">${htmlLines}</div>
          ${translationBlock}
          <div class="subtitle-actions">
            <button class="translate-btn" data-id="${entry.id}" ${entry.translation ? 'disabled' : ''}>
              ${entry.translation ? 'Переведено' : 'Перевести'}
            </button>
            <button class="speak-btn" data-speak="${escapeHtml(entry.text.replace(/\n/g, ' '))}" title="Озвучить">🔊</button>
          </div>
          <div class="subtitle-meta">${time}</div>
        </div>
      `;
    })
    .join('');

  attachSubtitleListeners();
}

function attachSubtitleListeners() {
  // Перевод строки по кнопке
  document.querySelectorAll('.translate-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const entry = subtitleHistory.find((e) => e.id === id);
      if (!entry || entry.translation) return;
      btn.textContent = '...';
      btn.disabled = true;
      try {
        const translation = await translateText(entry.text.replace(/\n/g, ' '));
        entry.translation = translation;
        await bumpStat('linesTranslated');
        renderSubtitleList();
      } catch (e) {
        btn.textContent = 'Ошибка, повторить';
        btn.disabled = false;
      }
    });
  });

  // Клик по слову → тултип с переводом и кнопкой добавления
  document.querySelectorAll('.word').forEach((span) => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const word = span.dataset.word;
      const card = span.closest('.subtitle-card');
      const id = card.dataset.id;
      const entry = subtitleHistory.find((ent) => ent.id === id);
      const context = entry ? entry.text.replace(/\n/g, ' ') : '';
      const source = entry ? {
        title: extractCleanTitle(entry.pageTitle || ''),
        url: (entry.url || '').replace(/#.*$/, '').replace(/\?.*$/, '')
      } : null;
      showWordTooltip(span, word, context, source);
    });
  });

  // Озвучка
  document.querySelectorAll('.speak-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      speak(btn.dataset.speak);
    });
  });
}

function speak(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

// ===== Dictionary =====
async function addWordToDictionary(word, context, prefetchedTranslation = null, source = null) {
  const normalized = word.toLowerCase();
  if (dictionary.some((d) => d.word.toLowerCase() === normalized)) {
    return; // уже есть
  }
  let translation = prefetchedTranslation;
  if (!translation) {
    try {
      translation = await translateText(word);
    } catch (e) {
      translation = '(ошибка перевода)';
    }
  }
  const newEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    word: word,
    translation: translation,
    context: context,
    source: source,
    addedAt: Date.now(),
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    dueAt: Date.now()
  };
  dictionary.unshift(newEntry);
  await storageSet(STORE_KEYS.DICTIONARY, dictionary);
  // Бэкап в sync делает background.js через chrome.storage.onChanged
  await bumpStat('wordsAdded');
}

async function removeWordFromDictionary(id) {
  dictionary = dictionary.filter((d) => d.id !== id);
  await storageSet(STORE_KEYS.DICTIONARY, dictionary);
}

function wordForm(n) {
  if (n % 100 >= 11 && n % 100 <= 14) return 'слов';
  const l = n % 10;
  if (l === 1) return 'слово';
  if (l >= 2 && l <= 4) return 'слова';
  return 'слов';
}

function renderDictionary(filter = '') {
  const container = document.getElementById('dictionary-list');
  const q = filter.trim().toLowerCase();

  const list = q
    ? dictionary.filter(d =>
        d.word.toLowerCase().includes(q) || d.translation.toLowerCase().includes(q))
    : dictionary;

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">Словарь пуст. Кликай по словам в субтитрах, чтобы добавить их.</p>';
    return;
  }

  // Группировка по источнику
  const groups = new Map();
  list.forEach(d => {
    const url     = d.source?.url   || '';
    const raw     = d.source?.title || '';
    const cleaned = extractCleanTitle(raw) || raw;
    if (!groups.has(url)) groups.set(url, { url, displayName: getSourceDisplayName(url, cleaned), words: [] });
    groups.get(url).words.push(d);
  });

  const sortedGroups = [...groups.values()].sort((a, b) => b.words.length - a.words.length);
  const searching = q.length > 0;

  const dictCardHtml = d => `
    <div class="dict-card" data-id="${d.id}">
      <div class="dict-word-block">
        <div class="dict-word">${escapeHtml(d.word)} <button class="speak-btn" data-speak="${escapeHtml(d.word)}" title="Озвучить">🔊</button></div>
        <div class="dict-translation">${escapeHtml(d.translation)}</div>
        ${d.context ? `<div class="dict-context">«${escapeHtml(d.context)}»</div>` : ''}
      </div>
      <div class="dict-actions">
        <button class="icon-btn danger" data-remove="${d.id}" title="Удалить">✕</button>
      </div>
    </div>`;

  if (sortedGroups.length === 1 && !sortedGroups[0].url) {
    // Один безымянный источник — плоский список
    container.innerHTML = list.map(dictCardHtml).join('');
  } else {
    // Аккордеон по сериалам
    container.innerHTML = sortedGroups.map(group => {
      const isCollapsed = !searching && collapsedSources.has(group.url);
      const title   = group.displayName || 'Без источника';
      const count   = group.words.length;
      const urlAttr = escapeHtml(group.url);
      const editBtn = group.url
        ? `<button class="source-rename-btn" data-url="${urlAttr}" title="Переименовать">✏️</button>`
        : '';
      return `
        <div class="source-group ${isCollapsed ? 'collapsed' : ''}" data-url="${urlAttr}">
          <div class="source-group-header">
            <span class="source-toggle"></span>
            <span class="source-group-title">${escapeHtml(title)}</span>
            <span class="source-group-count">${count} ${wordForm(count)}</span>
            ${editBtn}
          </div>
          <div class="source-group-body">
            ${group.words.map(dictCardHtml).join('')}
          </div>
        </div>`;
    }).join('');

    // Сворачивание/разворачивание по клику на заголовок
    container.querySelectorAll('.source-group-header').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('.source-rename-btn')) return;
        const group = header.closest('.source-group');
        const url = group.dataset.url;
        if (collapsedSources.has(url)) collapsedSources.delete(url);
        else collapsedSources.add(url);
        renderDictionary(filter);
      });
    });

    // Переименование
    container.querySelectorAll('.source-rename-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const url = btn.dataset.url;
        const title = btn.closest('.source-group-header').querySelector('.source-group-title').textContent;
        promptRenameSource(url, title);
      });
    });
  }

  // Общие обработчики
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removeWordFromDictionary(btn.dataset.remove);
      renderDictionary(document.getElementById('dict-search').value);
    });
  });

  container.querySelectorAll('.speak-btn').forEach(btn => {
    btn.addEventListener('click', () => speak(btn.dataset.speak));
  });
}

// ===== Spaced repetition (упрощённый SM-2) =====
let currentCard = null;
let cardFlipped = false;

function getDueCards() {
  const now = Date.now();
  return dictionary.filter((d) => d.dueAt <= now);
}

function renderPractice() {
  const container = document.getElementById('practice-area');
  const due = getDueCards();

  if (due.length === 0) {
    container.innerHTML = dictionary.length === 0
      ? '<p class="empty-state">В словаре пока нет слов для повторения.</p>'
      : '<p class="empty-state">Все слова повторены. Возвращайся позже!</p>';
    currentCard = null;
    return;
  }

  currentCard = due[0];
  cardFlipped = false;
  renderCurrentCard(due.length);
}

function renderCurrentCard(dueCount) {
  const container = document.getElementById('practice-area');
  if (!currentCard) return;

  container.innerHTML = `
    <div class="practice-progress">Осталось повторить: ${dueCount}</div>
    <div class="flashcard" id="flashcard">
      <div class="flashcard-front">${escapeHtml(currentCard.word)}</div>
      ${cardFlipped ? `<div class="flashcard-back">${escapeHtml(currentCard.translation)}</div>` : ''}
      ${cardFlipped && currentCard.context ? `<div class="flashcard-context">«${escapeHtml(currentCard.context)}»</div>` : ''}
      ${!cardFlipped ? '<div class="flashcard-hint">Нажми, чтобы увидеть перевод</div>' : ''}
    </div>
    ${cardFlipped ? `
      <div class="practice-controls">
        <button class="grade-btn grade-again" data-grade="0">Забыл</button>
        <button class="grade-btn grade-hard" data-grade="3">Сложно</button>
        <button class="grade-btn grade-good" data-grade="4">Хорошо</button>
        <button class="grade-btn grade-easy" data-grade="5">Легко</button>
      </div>
    ` : ''}
  `;

  document.getElementById('flashcard').addEventListener('click', () => {
    if (!cardFlipped) {
      cardFlipped = true;
      renderCurrentCard(dueCount);
    }
  });

  container.querySelectorAll('[data-grade]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await gradeCard(currentCard, parseInt(btn.dataset.grade, 10));
      renderPractice();
    });
  });
}

// Упрощённая версия SM-2: grade 0-5, обновляем interval/easeFactor/dueAt
async function gradeCard(card, grade) {
  if (grade < 3) {
    card.repetitions = 0;
    card.interval = 1; // повторить завтра
  } else {
    card.easeFactor = Math.max(1.3, card.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    card.repetitions += 1;
    if (card.repetitions === 1) card.interval = 1;
    else if (card.repetitions === 2) card.interval = 3;
    else card.interval = Math.round(card.interval * card.easeFactor);
  }
  card.dueAt = Date.now() + card.interval * 24 * 60 * 60 * 1000;
  await storageSet(STORE_KEYS.DICTIONARY, dictionary);
  await bumpStat('reviewsDone');
}

// ===== Stats =====
async function bumpStat(key) {
  const stats = await storageGet(STORE_KEYS.STATS, { wordsAdded: 0, reviewsDone: 0, linesTranslated: 0 });
  stats[key] = (stats[key] || 0) + 1;
  await storageSet(STORE_KEYS.STATS, stats);
}

async function renderStats() {
  const stats = await storageGet(STORE_KEYS.STATS, { wordsAdded: 0, reviewsDone: 0, linesTranslated: 0 });
  const dueCount = getDueCards().length;
  const manifest = chrome.runtime.getManifest();
  const container = document.getElementById('stats-area');
  container.innerHTML = `
    <div class="stat-card"><div class="stat-value">${dictionary.length}</div><div class="stat-label">слов в словаре</div></div>
    <div class="stat-card"><div class="stat-value">${stats.reviewsDone || 0}</div><div class="stat-label">повторений сделано</div></div>
    <div class="stat-card"><div class="stat-value">${dueCount}</div><div class="stat-label">ждут повторения</div></div>
    <div class="stat-card"><div class="stat-value">${subtitleHistory.length}</div><div class="stat-label">строк субтитров в истории</div></div>
    <div class="update-box">
      <div class="update-top">
        <span class="update-ver">v${manifest.version}</span>
        <button id="check-update-btn" class="ghost-btn">Проверить обновления</button>
      </div>
      <div id="update-status" class="update-status"></div>
    </div>
  `;

  document.getElementById('check-update-btn').addEventListener('click', checkForUpdates);
}

async function checkForUpdates() {
  const statusEl = document.getElementById('update-status');
  const btn = document.getElementById('check-update-btn');
  if (!statusEl || !btn) return;

  btn.disabled = true;
  statusEl.textContent = 'Проверяем...';
  statusEl.className = 'update-status';

  const current = chrome.runtime.getManifest().version;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' });
    if (!result || !result.ok) throw new Error();
    if (isNewerVersion(result.version, current)) {
      showUpdateBanner(result.version, current);
      statusEl.innerHTML = `Доступна версия <b>${result.version}</b> — Chrome обновит расширение автоматически в ближайшее время.`;
      statusEl.className = 'update-status update-available';
    } else {
      statusEl.textContent = '✓ Актуальная версия';
      statusEl.className = 'update-status update-ok';
    }
  } catch {
    statusEl.textContent = 'Ошибка при проверке. Нет интернета?';
    statusEl.className = 'update-status update-error';
  }
  btn.disabled = false;
}

function isNewerVersion(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

// Показываем баннер вверху попапа (не зависит от активного таба)
function showUpdateBanner(remoteVer, currentVer) {
  const banner = document.getElementById('update-banner');
  const text   = document.getElementById('update-banner-text');
  const reload = document.getElementById('update-banner-reload');
  if (!banner || !text || !reload) return;
  text.textContent = `Доступна версия ${remoteVer} (у вас ${currentVer}) — обновится автоматически`;
  banner.style.display = 'flex';
  reload.style.display = 'none'; // CWS обновляет сам, кнопка не нужна
}

// Тихая автопроверка при открытии попапа
async function autoCheckUpdates() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' });
    if (!result || !result.ok) return;
    const current = chrome.runtime.getManifest().version;
    if (isNewerVersion(result.version, current)) showUpdateBanner(result.version, current);
  } catch {}
}

// ===== Восстановление словаря из sync =====
// Бэкап в sync выполняет background.js (chrome.storage.onChanged) — единая точка,
// ловит записи и из content.js, и из popup.js. Здесь — только чтение (страховка
// на случай, если background ещё не успел восстановить local при открытии попапа).
async function restoreFromSync() {
  return new Promise(resolve => {
    chrome.storage.sync.get('rsd_bak_n', res => {
      const n = res.rsd_bak_n || 0;
      if (!n) return resolve([]);
      const keys = Array.from({ length: n }, (_, i) => 'rsd_bak_' + i);
      chrome.storage.sync.get(keys, res2 => {
        try { resolve(JSON.parse(keys.map(k => res2[k] || '').join('')) || []); }
        catch { resolve([]); }
      });
    });
  });
}

// ===== Export / Import =====
function exportDictionary() {
  if (dictionary.length === 0) return;
  const json = JSON.stringify(dictionary, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rezka-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importDictionary(file) {
  const statusEl = document.getElementById('dict-import-status');
  const showStatus = (msg, type) => {
    statusEl.textContent = msg;
    statusEl.className = `dict-import-status ${type}`;
    statusEl.style.display = 'block';
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  };

  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('not an array');

    let added = 0;
    for (const entry of imported) {
      if (!entry.word) continue;
      if (dictionary.some((d) => d.word.toLowerCase() === entry.word.toLowerCase())) continue;
      dictionary.unshift({
        id:          entry.id          ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        word:        entry.word,
        translation: entry.translation ?? '',
        context:     entry.context     ?? '',
        source:      entry.source      ?? null,
        addedAt:     entry.addedAt     ?? Date.now(),
        interval:    entry.interval    ?? 0,
        repetitions: entry.repetitions ?? 0,
        easeFactor:  entry.easeFactor  ?? 2.5,
        dueAt:       entry.dueAt       ?? Date.now(),
      });
      added++;
    }

    await storageSet(STORE_KEYS.DICTIONARY, dictionary);
    // Бэкап в sync подхватит background.js через onChanged
    renderDictionary(document.getElementById('dict-search')?.value || '');
    showStatus(`Импортировано: ${added} новых слов`, 'ok');
  } catch {
    showStatus('Ошибка: неверный формат файла', 'err');
  }
}

// ===== Init =====
async function init() {
  setupTabs();

  // Используем local, только если там есть данные; иначе восстанавливаем из sync.
  // Это нужно, чтобы словарь восстанавливался после переустановки или на другом компьютере.
  const localRes = await new Promise(r => chrome.storage.local.get('rsd_dictionary', r));
  const localDict = localRes.rsd_dictionary;
  if (Array.isArray(localDict) && localDict.length > 0) {
    dictionary = localDict;
  } else {
    // local пуст — пробуем восстановить из sync (страховка к background.onInstalled)
    dictionary = await restoreFromSync();
    if (dictionary.length > 0) await storageSet(STORE_KEYS.DICTIONARY, dictionary);
  }

  const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  subtitleHistory = (resp && resp.history) || [];
  renderSubtitleList();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'HISTORY_UPDATED') {
      subtitleHistory = message.history;
      renderSubtitleList();
    }
  });

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    subtitleHistory = [];
    renderSubtitleList();
  });

  document.getElementById('dict-search').addEventListener('input', (e) => {
    renderDictionary(e.target.value);
  });

  document.getElementById('dict-export-btn').addEventListener('click', exportDictionary);

  document.getElementById('dict-import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importDictionary(file);
    e.target.value = ''; // сбрасываем, чтобы повторный выбор того же файла тоже срабатывал
  });

  // Тихая проверка обновлений при каждом открытии попапа
  autoCheckUpdates();
}

if (typeof module === 'undefined') init();

// ===== Test exports (Node.js only, no-op in browser) =====
if (typeof module !== 'undefined') {
  module.exports = {
    escapeHtml,
    wordForm,
    extractCleanTitle,
    getSourceDisplayName,
    setSourceName,
    getSourceNames,
    translateText,
    storageGet,
    storageSet,
    wrapWordsClickable,
    isNewerVersion,
    getDueCards,
    gradeCard,
    addWordToDictionary,
    removeWordFromDictionary,
    restoreFromSync,
    bumpStat,
    _setDictionary: (d) => { dictionary = d; },
    _getDictionary: () => dictionary,
  };
}
