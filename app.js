(() => {
  'use strict';

  const QUIZ = window.QUIZ_BANK;
  const DURATION_SECONDS = 60 * 60;
  const STORAGE_PREFIX = 'ais_quiz_attempt_v1_set_';
  const LETTERS = ['A', 'B', 'C', 'D'];

  const $ = (selector) => document.querySelector(selector);
  const els = {
    totalQuestions: $('#totalQuestions'),
    menuView: $('#menuView'),
    examView: $('#examView'),
    resultView: $('#resultView'),
    setGrid: $('#setGrid'),
    clearAllBtn: $('#clearAllBtn'),
    examTitle: $('#examTitle'),
    timer: $('#timer'),
    timeMeter: $('#timeMeter'),
    answeredCount: $('#answeredCount'),
    correctCount: $('#correctCount'),
    wrongCount: $('#wrongCount'),
    submitBtn: $('#submitBtn'),
    backMenuBtn: $('#backMenuBtn'),
    palette: $('#palette'),
    paletteProgress: $('#paletteProgress'),
    questionCard: $('#questionCard'),
    resultTitle: $('#resultTitle'),
    scoreRing: $('#scoreRing'),
    scoreText: $('#scoreText'),
    resultSummary: $('#resultSummary'),
    resultStats: $('#resultStats'),
    reviewBtn: $('#reviewBtn'),
    retryBtn: $('#retryBtn'),
    resultMenuBtn: $('#resultMenuBtn'),
    reviewList: $('#reviewList'),
    toast: $('#toast'),
  };

  let state = null;
  let timerId = null;
  let toastId = null;

  function init() {
    if (!QUIZ || !Array.isArray(QUIZ.sets)) {
      document.body.innerHTML = '<main style="padding:24px;font-family:Arial,sans-serif"><h1>Không tải được dữ liệu câu hỏi</h1><p>Hãy kiểm tra file data.js có nằm cùng thư mục với index.html không.</p></main>';
      return;
    }

    els.totalQuestions.textContent = QUIZ.totalQuestions || countAllQuestions();
    renderMenu();
    bindGlobalEvents();
  }

  function countAllQuestions() {
    return QUIZ.sets.reduce((sum, set) => sum + set.questions.length, 0);
  }

  function bindGlobalEvents() {
    els.clearAllBtn.addEventListener('click', () => {
      if (!confirm('Bạn có chắc muốn xóa toàn bộ tiến trình làm bài đã lưu không?')) return;
      QUIZ.sets.forEach((set) => localStorage.removeItem(storageKey(set.setNumber)));
      renderMenu();
      showToast('Đã xóa toàn bộ tiến trình.');
    });

    els.submitBtn.addEventListener('click', () => {
      if (!state || state.finished) return;
      const unanswered = getStats().unanswered;
      const message = unanswered > 0
        ? `Bạn còn ${unanswered} câu chưa làm. Bạn vẫn muốn nộp bài?`
        : 'Bạn muốn nộp bài và xem kết quả?';
      if (confirm(message)) finishExam('submitted');
    });

    els.backMenuBtn.addEventListener('click', () => {
      saveState();
      stopTimer();
      showView('menu');
      renderMenu();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    els.resultMenuBtn.addEventListener('click', () => {
      stopTimer();
      showView('menu');
      renderMenu();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    els.retryBtn.addEventListener('click', () => {
      if (!state) return;
      const setNumber = state.setNumber;
      if (!confirm(`Làm lại Đề ${setNumber}? Đáp án sẽ được đảo ngẫu nhiên lại từ đầu.`)) return;
      startNewAttempt(setNumber);
    });

    els.reviewBtn.addEventListener('click', () => {
      if (!state) return;
      renderReview();
      els.reviewList.classList.toggle('review-list--show');
      els.reviewBtn.textContent = els.reviewList.classList.contains('review-list--show') ? 'Ẩn phần xem lại' : 'Xem lại bài';
      if (els.reviewList.classList.contains('review-list--show')) {
        els.reviewList.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.addEventListener('keydown', handleKeyboard);
  }

  function renderMenu() {
    els.setGrid.innerHTML = '';
    QUIZ.sets.forEach((set) => {
      const saved = loadState(set.setNumber);
      const stats = saved ? getStats(saved) : null;
      const statusClass = !saved ? '' : saved.finished ? ' status-pill--done' : ' status-pill--active';
      const statusText = !saved ? 'Chưa làm' : saved.finished ? `Đã làm: ${stats.correct}/${set.questions.length}` : `Đang làm: ${stats.answered}/${set.questions.length}`;
      const breakdown = getBreakdown(set.questions);

      const card = document.createElement('article');
      card.className = 'set-card';
      card.innerHTML = `
        <div class="set-card__top">
          <span class="set-badge">${set.setNumber}</span>
          <span class="status-pill${statusClass}">${statusText}</span>
        </div>
        <h3>Đề số ${set.setNumber}</h3>
        <p>50 câu trộn lẫn chủ đề. Khi bắt đầu mới, thứ tự đáp án sẽ được đảo tự động.</p>
        <div class="breakdown">${breakdown.map(([name, count]) => `<span class="chip">${escapeHtml(name)} ${count}</span>`).join('')}</div>
        <div class="set-card__actions">
          <button class="primary-btn" type="button" data-action="new" data-set="${set.setNumber}">${saved ? 'Làm lại từ đầu' : 'Bắt đầu làm'}</button>
          ${saved && !saved.finished ? `<button class="secondary-btn" type="button" data-action="resume" data-set="${set.setNumber}">Làm tiếp</button>` : ''}
          ${saved && saved.finished ? `<button class="secondary-btn" type="button" data-action="review-result" data-set="${set.setNumber}">Xem kết quả</button>` : ''}
        </div>
      `;
      els.setGrid.appendChild(card);
    });

    els.setGrid.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const setNumber = Number(button.dataset.set);
        const action = button.dataset.action;
        if (action === 'new') {
          const saved = loadState(setNumber);
          if (saved && !confirm('Đề này đã có tiến trình/kết quả cũ. Làm lại sẽ đảo đáp án và xóa tiến trình cũ. Tiếp tục?')) return;
          startNewAttempt(setNumber);
        }
        if (action === 'resume') resumeAttempt(setNumber);
        if (action === 'review-result') showSavedResult(setNumber);
      });
    });
  }

  function getBreakdown(questions) {
    const preferredOrder = ['ATS', 'CNS', 'AGA', 'OTHERS', 'PUB', 'DATA', 'K2-NOTAM'];
    const map = new Map();
    questions.forEach((q) => {
      const key = q.category || q.subcategory || q.source || 'Khác';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const ia = preferredOrder.indexOf(a[0]);
      const ib = preferredOrder.indexOf(b[0]);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a[0].localeCompare(b[0], 'vi');
    });
  }

  function startNewAttempt(setNumber) {
    const set = getSet(setNumber);
    if (!set) return;

    state = {
      version: 1,
      setNumber,
      startedAt: Date.now(),
      finishedAt: null,
      finishReason: null,
      durationSeconds: DURATION_SECONDS,
      currentIndex: 0,
      finished: false,
      answers: set.questions.map((question) => {
        const shuffledOptions = shuffle(question.options.map((text, originalIndex) => ({
          text,
          originalIndex,
          isCorrect: originalIndex === question.answerIndex,
        })));
        return {
          questionId: question.id,
          selectedIndex: null,
          isCorrect: null,
          options: shuffledOptions,
        };
      }),
    };

    saveState();
    showExam();
    showToast(`Đã bắt đầu Đề ${setNumber}. Chúc bạn làm bài tốt!`);
  }

  function resumeAttempt(setNumber) {
    const saved = loadState(setNumber);
    if (!saved) {
      startNewAttempt(setNumber);
      return;
    }
    state = saved;
    if (!state.finished && getRemainingSeconds() <= 0) {
      finishExam('timeout');
      return;
    }
    showExam();
    showToast(`Đã mở lại Đề ${setNumber}.`);
  }

  function showSavedResult(setNumber) {
    const saved = loadState(setNumber);
    if (!saved) return;
    state = saved;
    stopTimer();
    showView('result');
    renderResult();
    els.reviewList.classList.remove('review-list--show');
    els.reviewBtn.textContent = 'Xem lại bài';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showExam() {
    if (!state) return;
    showView('exam');
    els.examTitle.textContent = `Đề số ${state.setNumber}`;
    renderQuestion();
    renderPalette();
    updateStats();
    startTimer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderQuestion() {
    const set = getSet(state.setNumber);
    const question = set.questions[state.currentIndex];
    const answer = state.answers[state.currentIndex];
    const locked = answer.selectedIndex !== null || state.finished;
    const correctOption = answer.options.find((option) => option.isCorrect);
    const selectedOption = answer.selectedIndex !== null ? answer.options[answer.selectedIndex] : null;

    let feedback = '';
    if (state.finished && answer.selectedIndex === null) {
      feedback = `<div class="feedback feedback--show feedback--neutral">Bạn chưa chọn câu này. Đáp án đúng là: ${escapeHtml(correctOption.text)}</div>`;
    } else if (answer.selectedIndex !== null && selectedOption?.isCorrect) {
      feedback = `<div class="feedback feedback--show feedback--correct">Chính xác. Câu này đã được khóa đáp án.</div>`;
    } else if (answer.selectedIndex !== null) {
      feedback = `<div class="feedback feedback--show feedback--wrong">Chưa đúng. Đáp án đúng là: ${escapeHtml(correctOption.text)}</div>`;
    }

    els.questionCard.innerHTML = `
      <div class="question-meta">
        <span class="question-number">Câu ${state.currentIndex + 1}/${set.questions.length}</span>
        <span class="chip">${escapeHtml(question.category || 'Khác')}</span>
        ${question.subcategory ? `<span class="chip">${escapeHtml(question.subcategory)}</span>` : ''}
        <span class="chip">${escapeHtml(question.source || '').toUpperCase()}</span>
      </div>
      <h2 class="question-text">${escapeHtml(question.question)}</h2>
      <div class="option-list">
        ${answer.options.map((option, index) => {
          const shouldRevealCorrect = answer.selectedIndex !== null || state.finished;
          const isWrongSelection = answer.selectedIndex === index && !option.isCorrect;
          const classes = [
            'option-btn',
            shouldRevealCorrect && option.isCorrect ? 'is-correct' : '',
            isWrongSelection ? 'is-wrong' : '',
          ].filter(Boolean).join(' ');
          return `
            <button class="${classes}" type="button" data-option="${index}" ${locked ? 'disabled' : ''}>
              <span class="option-letter">${LETTERS[index]}</span>
              <span class="option-text">${escapeHtml(option.text)}</span>
            </button>
          `;
        }).join('')}
      </div>
      ${feedback}
      ${question.reference ? `<div class="reference"><strong>Tài liệu tham chiếu:</strong> ${escapeHtml(question.reference)}</div>` : ''}
      <div class="question-footer">
        <button class="ghost-btn" id="prevQuestionBtn" type="button" ${state.currentIndex === 0 ? 'disabled' : ''}>← Câu trước</button>
        <button class="secondary-btn" id="nextQuestionBtn" type="button">${state.currentIndex === set.questions.length - 1 ? 'Đến kết quả' : 'Câu tiếp →'}</button>
      </div>
    `;

    els.questionCard.querySelectorAll('button[data-option]').forEach((button) => {
      button.addEventListener('click', () => selectOption(Number(button.dataset.option)));
    });

    $('#prevQuestionBtn').addEventListener('click', () => goToQuestion(state.currentIndex - 1));
    $('#nextQuestionBtn').addEventListener('click', () => {
      if (state.currentIndex === set.questions.length - 1) {
        if (state.finished) {
          showView('result');
          renderResult();
          return;
        }
        showToast('Bạn đang ở câu cuối. Bấm “Nộp bài” để xem kết quả.');
      } else {
        goToQuestion(state.currentIndex + 1);
      }
    });
  }

  function selectOption(optionIndex) {
    if (!state || state.finished) return;
    const answer = state.answers[state.currentIndex];
    if (answer.selectedIndex !== null) return;

    const selected = answer.options[optionIndex];
    answer.selectedIndex = optionIndex;
    answer.isCorrect = Boolean(selected?.isCorrect);
    saveState();

    renderQuestion();
    renderPalette();
    updateStats();
    showToast(answer.isCorrect ? 'Đúng rồi.' : 'Sai rồi, đáp án đúng đã được tô xanh.');
  }

  function goToQuestion(index) {
    const set = getSet(state.setNumber);
    if (index < 0 || index >= set.questions.length) return;
    state.currentIndex = index;
    saveState();
    renderQuestion();
    renderPalette();
    const cardTop = els.questionCard.getBoundingClientRect().top + window.scrollY - 18;
    window.scrollTo({ top: Math.max(0, cardTop), behavior: 'smooth' });
  }

  function renderPalette() {
    const set = getSet(state.setNumber);
    els.palette.innerHTML = '';
    state.answers.forEach((answer, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(index + 1);
      button.className = [
        index === state.currentIndex ? 'is-current' : '',
        answer.isCorrect === true ? 'is-correct' : '',
        answer.isCorrect === false ? 'is-wrong' : '',
      ].filter(Boolean).join(' ');
      button.addEventListener('click', () => goToQuestion(index));
      els.palette.appendChild(button);
    });
    const stats = getStats();
    els.paletteProgress.textContent = `${stats.answered}/${set.questions.length}`;
  }

  function updateStats() {
    const stats = getStats();
    els.answeredCount.textContent = stats.answered;
    els.correctCount.textContent = stats.correct;
    els.wrongCount.textContent = stats.wrong;
  }

  function startTimer() {
    stopTimer();
    tickTimer();
    if (!state.finished) {
      timerId = window.setInterval(tickTimer, 1000);
    }
  }

  function stopTimer() {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
  }

  function tickTimer() {
    if (!state) return;
    const remaining = getRemainingSeconds();
    const percent = Math.max(0, Math.min(1, remaining / state.durationSeconds));
    els.timer.textContent = formatTime(remaining);
    els.timeMeter.style.transform = `scaleX(${percent})`;
    els.timer.classList.toggle('timer--warning', remaining <= 600 && remaining > 180);
    els.timer.classList.toggle('timer--danger', remaining <= 180);

    if (!state.finished && remaining <= 0) {
      finishExam('timeout');
    }
  }

  function finishExam(reason) {
    if (!state) return;
    state.finished = true;
    state.finishedAt = Date.now();
    state.finishReason = reason;
    saveState();
    stopTimer();
    showView('result');
    renderResult();
    showToast(reason === 'timeout' ? 'Hết giờ. Hệ thống đã tự nộp bài.' : 'Đã nộp bài.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderResult() {
    const set = getSet(state.setNumber);
    const stats = getStats();
    const percent = Math.round((stats.correct / set.questions.length) * 100);
    const usedSeconds = getUsedSeconds();

    els.resultTitle.textContent = `Kết quả Đề số ${state.setNumber}`;
    els.scoreText.textContent = `${stats.correct}/${set.questions.length}`;
    els.scoreRing.style.setProperty('--p', `${(stats.correct / set.questions.length) * 360}deg`);
    els.resultSummary.textContent = `${resultMessage(percent)} Bạn làm đúng ${stats.correct}/${set.questions.length} câu, đạt ${percent}%. Thời gian sử dụng: ${formatTime(usedSeconds)}.`;
    els.resultStats.innerHTML = `
      <div><strong>${stats.answered}</strong><span>Đã làm</span></div>
      <div><strong>${stats.wrong}</strong><span>Sai</span></div>
      <div><strong>${stats.unanswered}</strong><span>Chưa làm</span></div>
    `;
    els.reviewList.classList.remove('review-list--show');
    els.reviewBtn.textContent = 'Xem lại bài';
  }

  function renderReview() {
    const set = getSet(state.setNumber);
    els.reviewList.innerHTML = '';
    state.answers.forEach((answer, index) => {
      const question = set.questions[index];
      const correctOption = answer.options.find((option) => option.isCorrect);
      const selectedOption = answer.selectedIndex !== null ? answer.options[answer.selectedIndex] : null;
      const status = answer.isCorrect === true ? 'Đúng' : answer.isCorrect === false ? 'Sai' : 'Chưa làm';
      const statusClass = answer.isCorrect === true ? 'feedback--correct' : answer.isCorrect === false ? 'feedback--wrong' : 'feedback--neutral';
      const item = document.createElement('article');
      item.className = 'review-item';
      item.innerHTML = `
        <div class="review-item__head">
          <h3>Câu ${index + 1}: ${escapeHtml(question.category || '')}${question.subcategory ? ' / ' + escapeHtml(question.subcategory) : ''}</h3>
          <span class="feedback feedback--show ${statusClass}" style="margin:0;padding:7px 10px">${status}</span>
        </div>
        <p><strong>Đề bài:</strong> ${escapeHtml(question.question)}</p>
        <p><strong>Bạn chọn:</strong> ${selectedOption ? escapeHtml(selectedOption.text) : 'Chưa chọn'}</p>
        <p><strong>Đáp án đúng:</strong> ${escapeHtml(correctOption.text)}</p>
        ${question.reference ? `<p class="reference"><strong>Tài liệu tham chiếu:</strong> ${escapeHtml(question.reference)}</p>` : ''}
      `;
      els.reviewList.appendChild(item);
    });
  }

  function getStats(customState = state) {
    const answers = customState.answers || [];
    const answered = answers.filter((answer) => answer.selectedIndex !== null).length;
    const correct = answers.filter((answer) => answer.isCorrect === true).length;
    const wrong = answers.filter((answer) => answer.isCorrect === false).length;
    const total = answers.length;
    return { answered, correct, wrong, unanswered: total - answered, total };
  }

  function getRemainingSeconds() {
    if (!state) return DURATION_SECONDS;
    if (state.finished && state.finishedAt) {
      return Math.max(0, state.durationSeconds - Math.floor((state.finishedAt - state.startedAt) / 1000));
    }
    return Math.max(0, state.durationSeconds - Math.floor((Date.now() - state.startedAt) / 1000));
  }

  function getUsedSeconds() {
    if (!state) return 0;
    const end = state.finishedAt || Date.now();
    return Math.min(state.durationSeconds, Math.max(0, Math.floor((end - state.startedAt) / 1000)));
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function resultMessage(percent) {
    if (percent >= 90) return 'Rất tốt.';
    if (percent >= 75) return 'Kết quả khá ổn.';
    if (percent >= 60) return 'Bạn đã nắm được phần cơ bản.';
    return 'Bạn nên xem lại các câu sai và làm lại đề này.';
  }

  function getSet(setNumber) {
    return QUIZ.sets.find((set) => Number(set.setNumber) === Number(setNumber));
  }

  function storageKey(setNumber) {
    return `${STORAGE_PREFIX}${setNumber}`;
  }

  function saveState() {
    if (!state) return;
    try {
      localStorage.setItem(storageKey(state.setNumber), JSON.stringify(state));
    } catch (error) {
      console.warn('Không lưu được tiến trình:', error);
    }
  }

  function loadState(setNumber) {
    try {
      const raw = localStorage.getItem(storageKey(setNumber));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.answers)) return null;
      return parsed;
    } catch (error) {
      console.warn('Không đọc được tiến trình:', error);
      return null;
    }
  }

  function showView(name) {
    els.menuView.classList.toggle('view--active', name === 'menu');
    els.examView.classList.toggle('view--active', name === 'exam');
    els.resultView.classList.toggle('view--active', name === 'result');
  }

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('toast--show');
    window.clearTimeout(toastId);
    toastId = window.setTimeout(() => els.toast.classList.remove('toast--show'), 1800);
  }

  function handleKeyboard(event) {
    if (!state || !els.examView.classList.contains('view--active')) return;
    const key = event.key.toLowerCase();
    const currentAnswer = state.answers[state.currentIndex];
    const letterIndex = ['a', 'b', 'c', 'd'].indexOf(key);

    if (letterIndex !== -1 && currentAnswer.selectedIndex === null && !state.finished) {
      event.preventDefault();
      selectOption(letterIndex);
      return;
    }

    if (key === 'arrowleft') {
      event.preventDefault();
      goToQuestion(state.currentIndex - 1);
    }

    if (key === 'arrowright') {
      event.preventDefault();
      goToQuestion(state.currentIndex + 1);
    }
  }

  init();
})();
