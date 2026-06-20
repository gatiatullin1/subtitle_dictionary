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
      if (btn.dataset.tab === 'dictionary') renderDictionary();
      if (btn.dataset.tab === 'practice') renderPractice();
      if (btn.dataset.tab === 'stats') renderStats();
    });
  });
}

// ===== Word tooltip =====
let subtitleHistory = [];
let dictionary = [];

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

async function showWordTooltip(span, word, context) {
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
      await addWordToDictionary(word, context, fetchedTranslation);
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

// ===== Subtitles list =====

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function wrapWordsClickable(line) {
  // Разбиваем строку на слова и пробелы/пунктуацию, каждое слово оборачиваем в span.word
  return line.replace(/[A-Za-zÀ-ÖØ-öø-ÿ']+/g, (word) => {
    const isKnown = dictionary.some(
      (d) => d.word.toLowerCase() === word.toLowerCase()
    );
    const cls = isKnown ? 'word in-dict' : 'word';
    return `<span class="${cls}" data-word="${escapeHtml(word)}">${escapeHtml(word)}</span>`;
  });
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
      const htmlLines = lines.map((l) => wrapWordsClickable(escapeHtml(l))).join('<br>');
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
      showWordTooltip(span, word, context);
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
async function addWordToDictionary(word, context, prefetchedTranslation = null) {
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
    addedAt: Date.now(),
    // Параметры для упрощённого spaced repetition (вариант алгоритма SM-2)
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    dueAt: Date.now()
  };
  dictionary.unshift(newEntry);
  await storageSet(STORE_KEYS.DICTIONARY, dictionary);
  await bumpStat('wordsAdded');
}

async function removeWordFromDictionary(id) {
  dictionary = dictionary.filter((d) => d.id !== id);
  await storageSet(STORE_KEYS.DICTIONARY, dictionary);
}

function renderDictionary(filter = '') {
  const container = document.getElementById('dictionary-list');
  const q = filter.trim().toLowerCase();
  const list = q
    ? dictionary.filter((d) => d.word.toLowerCase().includes(q) || d.translation.toLowerCase().includes(q))
    : dictionary;

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">Словарь пуст. Кликай по словам в субтитрах, чтобы добавить их.</p>';
    return;
  }

  container.innerHTML = list
    .map(
      (d) => `
      <div class="dict-card" data-id="${d.id}">
        <div class="dict-word-block">
          <div class="dict-word">${escapeHtml(d.word)} <button class="speak-btn" data-speak="${escapeHtml(d.word)}" title="Озвучить">🔊</button></div>
          <div class="dict-translation">${escapeHtml(d.translation)}</div>
          ${d.context ? `<div class="dict-context">«${escapeHtml(d.context)}»</div>` : ''}
        </div>
        <div class="dict-actions">
          <button class="icon-btn danger" data-remove="${d.id}" title="Удалить">✕</button>
        </div>
      </div>
    `
    )
    .join('');

  container.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removeWordFromDictionary(btn.dataset.remove);
      renderDictionary(document.getElementById('dict-search').value);
    });
  });

  container.querySelectorAll('.speak-btn').forEach((btn) => {
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
  const container = document.getElementById('stats-area');
  container.innerHTML = `
    <div class="stat-card"><div class="stat-value">${dictionary.length}</div><div class="stat-label">слов в словаре</div></div>
    <div class="stat-card"><div class="stat-value">${stats.reviewsDone || 0}</div><div class="stat-label">повторений сделано</div></div>
    <div class="stat-card"><div class="stat-value">${dueCount}</div><div class="stat-label">ждут повторения</div></div>
    <div class="stat-card"><div class="stat-value">${subtitleHistory.length}</div><div class="stat-label">строк субтитров в истории</div></div>
  `;
}

// ===== Init =====
async function init() {
  setupTabs();

  dictionary = await storageGet(STORE_KEYS.DICTIONARY, []);

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
}

init();
