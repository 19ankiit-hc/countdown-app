(function () {
  "use strict";

  const STORAGE_KEY = "examCountdownExams";

  const form = document.getElementById("countdownForm");
  const formError = document.getElementById("formError");
  const examNameInput = document.getElementById("examName");
  const examDateInput = document.getElementById("examDate");
  const examList = document.getElementById("examList");
  const examsSection = document.getElementById("examsSection");
  const emptyState = document.getElementById("emptyState");
  const examCount = document.getElementById("examCount");
  const cardTemplate = document.getElementById("examCardTemplate");
  const historyCardTemplate = document.getElementById("historyCardTemplate");
  const historyBtn = document.getElementById("historyBtn");
  const historyBadge = document.getElementById("historyBadge");
  const historyPanel = document.getElementById("historyPanel");
  const historyBackdrop = document.getElementById("historyBackdrop");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  const alarmOverlay = document.getElementById("alarmOverlay");
  const alarmMessage = document.getElementById("alarmMessage");
  const alarmOkBtn = document.getElementById("alarmOkBtn");

  /** @type {{ id: string, name: string, target: number, alarmDismissed?: boolean }[]} */
  let exams = [];
  let tickInterval = null;

  let audioCtx = null;
  let beepInterval = null;
  let speechRepeatTimer = null;
  let currentAlarmExamId = null;
  /** @type {{ id: string, name: string }[]} */
  const alarmQueue = [];

  function pad(value) {
    return String(Math.max(0, value)).padStart(2, "0");
  }

  function formatDisplayDate(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  function getRemaining(target) {
    const diff = target - Date.now();

    if (diff <= 0) {
      return { days: 0, hours: 0, minutes: 0, finished: true };
    }

    const totalMinutes = Math.ceil(diff / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    return { days, hours, minutes, finished: false };
  }

  function isExamFinished(exam) {
    return getRemaining(exam.target).finished;
  }

  function getUpcomingExams() {
    return exams.filter(function (e) {
      return !isExamFinished(e);
    });
  }

  function getCompletedExams() {
    return exams
      .filter(isExamFinished)
      .sort(function (a, b) {
        return b.target - a.target;
      });
  }

  function getAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function unlockAudio() {
    getAudioContext();
  }

  function playBeep() {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(660, now + 0.15);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  function buildSpeechText(examName) {
    return "Good luck for your " + examName + " exam";
  }

  function stopSpeech() {
    if (speechRepeatTimer) {
      clearTimeout(speechRepeatTimer);
      speechRepeatTimer = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function stopBeepLoop() {
    if (beepInterval) {
      clearInterval(beepInterval);
      beepInterval = null;
    }
  }

  function stopAlarmSounds() {
    stopSpeech();
    stopBeepLoop();
  }

  function scheduleSpeech(examName) {
    if (currentAlarmExamId === null) return;
    if (!("speechSynthesis" in window)) return;

    const utterance = new SpeechSynthesisUtterance(buildSpeechText(examName));
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = function () {
      if (currentAlarmExamId === null) return;
      speechRepeatTimer = setTimeout(function () {
        scheduleSpeech(examName);
      }, 600);
    };

    utterance.onerror = function () {
      if (currentAlarmExamId === null) return;
      speechRepeatTimer = setTimeout(function () {
        scheduleSpeech(examName);
      }, 1200);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function startBeepLoop() {
    stopBeepLoop();
    playBeep();
    beepInterval = setInterval(playBeep, 1400);
  }

  function showAlarmModal(exam) {
    alarmMessage.innerHTML =
      "Good luck for your <strong>" + escapeHtml(exam.name) + "</strong> exam! " +
      "Your exam time has arrived.";
    alarmOverlay.hidden = false;
    alarmOkBtn.focus();
  }

  function hideAlarmModal() {
    alarmOverlay.hidden = true;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function markAlarmDismissed(examId) {
    const exam = exams.find(function (e) {
      return e.id === examId;
    });
    if (exam) {
      exam.alarmDismissed = true;
      saveExams();
    }
  }

  function startAlarm(exam) {
    currentAlarmExamId = exam.id;
    showAlarmModal(exam);
    unlockAudio();
    startBeepLoop();
    scheduleSpeech(exam.name);
  }

  function processNextAlarm() {
    if (alarmQueue.length === 0) return;
    const next = alarmQueue.shift();
    if (!next) return;
    const exam = exams.find(function (e) {
      return e.id === next.id;
    });
    if (exam && !exam.alarmDismissed && getRemaining(exam.target).finished) {
      startAlarm(exam);
    } else {
      processNextAlarm();
    }
  }

  function dismissAlarm() {
    if (currentAlarmExamId === null) return;

    const dismissedId = currentAlarmExamId;
    stopAlarmSounds();
    hideAlarmModal();
    markAlarmDismissed(dismissedId);
    currentAlarmExamId = null;
    renderAll();
    processNextAlarm();
  }

  function openHistoryPanel() {
    renderHistoryList();
    historyPanel.hidden = false;
    historyBackdrop.hidden = false;
    requestAnimationFrame(function () {
      historyPanel.classList.add("is-open");
    });
    historyBtn.setAttribute("aria-expanded", "true");
    closeHistoryBtn.focus();
  }

  function closeHistoryPanel() {
    historyPanel.classList.remove("is-open");
    historyBtn.setAttribute("aria-expanded", "false");
    setTimeout(function () {
      historyPanel.hidden = true;
      historyBackdrop.hidden = true;
    }, 280);
  }

  function updateHistoryBadge() {
    const count = getCompletedExams().length;
    if (count > 0) {
      historyBadge.textContent = String(count);
      historyBadge.hidden = false;
    } else {
      historyBadge.hidden = true;
    }
  }

  function queueAlarm(exam) {
    if (exam.alarmDismissed) return;
    if (currentAlarmExamId === exam.id) return;

    const queuedAlready = alarmQueue.some(function (e) {
      return e.id === exam.id;
    });
    if (queuedAlready) return;

    if (currentAlarmExamId !== null) {
      alarmQueue.push({ id: exam.id, name: exam.name });
      return;
    }

    startAlarm(exam);
  }

  function checkExamAlarm(exam) {
    if (!getRemaining(exam.target).finished) return;
    if (exam.alarmDismissed) return;
    queueAlarm(exam);
  }

  function saveExams() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
    } catch {
      /* ignore quota errors */
    }
  }

  function loadExams() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      exams = parsed.filter(function (e) {
        return (
          e &&
          typeof e.id === "string" &&
          typeof e.name === "string" &&
          typeof e.target === "number"
        );
      });
    } catch {
      exams = [];
    }
  }

  function updateEmptyState() {
    const upcoming = getUpcomingExams();
    const hasUpcoming = upcoming.length > 0;
    const hasAny = exams.length > 0;

    examsSection.hidden = !hasUpcoming;
    examCount.textContent = hasUpcoming
      ? upcoming.length + " upcoming"
      : "";

    if (hasUpcoming) {
      emptyState.hidden = true;
    } else {
      emptyState.hidden = false;
      emptyState.textContent = hasAny
        ? "No upcoming exams. Completed subjects are in History (top right)."
        : "No upcoming exams. Add a subject above to start counting down.";
    }

    updateHistoryBadge();
  }

  function updateExamCard(card, exam) {
    const remaining = getRemaining(exam.target);
    const status = card.querySelector(".status");

    card.querySelector(".days").textContent = pad(remaining.days);
    card.querySelector(".hours").textContent = pad(remaining.hours);
    card.querySelector(".minutes").textContent = pad(remaining.minutes);
    status.textContent = "Time remaining";
  }

  function tickAll() {
    let needsRerender = false;

    getUpcomingExams().forEach(function (exam) {
      const card = examList.querySelector('[data-exam-id="' + exam.id + '"]');
      if (card) {
        updateExamCard(card, exam);
      }
    });

    exams.forEach(function (exam) {
      if (!isExamFinished(exam)) return;

      const stillOnUpcomingList = examList.querySelector(
        '[data-exam-id="' + exam.id + '"]'
      );

      if (stillOnUpcomingList) {
        needsRerender = true;
        if (!exam.alarmDismissed) {
          checkExamAlarm(exam);
        }
      }
    });

    if (needsRerender) {
      renderAll();
    }
  }

  function ensureTicking() {
    if (exams.length === 0) {
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      return;
    }
    if (!tickInterval) {
      tickAll();
      tickInterval = setInterval(tickAll, 1000);
    }
  }

  function checkPendingAlarmsOnLoad() {
    exams.forEach(function (exam) {
      if (getRemaining(exam.target).finished && !exam.alarmDismissed) {
        checkExamAlarm(exam);
      }
    });
  }

  function bindRemoveButton(button, examId) {
    button.addEventListener("click", function () {
      if (currentAlarmExamId === examId) {
        dismissAlarm();
      }
      removeExam(examId);
    });
  }

  function createExamCard(exam) {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".exam-card");
    card.dataset.examId = exam.id;
    card.querySelector(".exam-title").textContent = exam.name;
    card.querySelector(".exam-datetime").textContent = formatDisplayDate(exam.target);
    bindRemoveButton(card.querySelector(".remove-exam"), exam.id);
    updateExamCard(card, exam);
    examList.appendChild(fragment);
  }

  function createHistoryCard(exam) {
    const fragment = historyCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".history-card");
    card.dataset.examId = exam.id;
    card.querySelector(".exam-title").textContent = exam.name;
    card.querySelector(".exam-datetime").textContent = formatDisplayDate(exam.target);
    bindRemoveButton(card.querySelector(".remove-exam"), exam.id);
    historyList.appendChild(fragment);
  }

  function renderExamList() {
    examList.innerHTML = "";
    getUpcomingExams()
      .sort(function (a, b) {
        return a.target - b.target;
      })
      .forEach(createExamCard);
    updateEmptyState();
    ensureTicking();
  }

  function renderHistoryList() {
    const completed = getCompletedExams();
    historyList.innerHTML = "";
    historyEmpty.hidden = completed.length > 0;

    completed.forEach(createHistoryCard);
    updateHistoryBadge();
  }

  function renderAll() {
    renderExamList();
    if (!historyPanel.hidden) {
      renderHistoryList();
    } else {
      updateHistoryBadge();
    }
  }

  function removeExam(id) {
    const idx = alarmQueue.findIndex(function (e) {
      return e.id === id;
    });
    if (idx !== -1) alarmQueue.splice(idx, 1);
    exams = exams.filter(function (e) {
      return e.id !== id;
    });
    saveExams();
    renderAll();
  }

  function addExam(name, date) {
    const exam = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "exam-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9),
      name: name,
      target: date.getTime(),
      alarmDismissed: false,
    };
    exams.push(exam);
    saveExams();
    renderAll();
    examNameInput.value = "";
    examDateInput.value = "";
    examNameInput.focus();
  }

  function setMinDate() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    examDateInput.min = now.toISOString().slice(0, 16);
  }

  alarmOkBtn.addEventListener("click", dismissAlarm);
  historyBtn.addEventListener("click", openHistoryPanel);
  closeHistoryBtn.addEventListener("click", closeHistoryPanel);
  historyBackdrop.addEventListener("click", closeHistoryPanel);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !historyPanel.hidden) {
      closeHistoryPanel();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    unlockAudio();
    showError("");

    const name = examNameInput.value.trim();
    const dateValue = examDateInput.value;

    if (!name) {
      showError("Please enter a subject or exam name.");
      examNameInput.focus();
      return;
    }

    if (!dateValue) {
      showError("Please select an exam date and time.");
      examDateInput.focus();
      return;
    }

    const selected = new Date(dateValue);
    if (Number.isNaN(selected.getTime())) {
      showError("Invalid date. Please try again.");
      return;
    }

    if (selected.getTime() <= Date.now()) {
      showError("Exam date must be in the future.");
      examDateInput.focus();
      return;
    }

    const duplicate = exams.some(function (e) {
      return (
        e.name.toLowerCase() === name.toLowerCase() && e.target === selected.getTime()
      );
    });
    if (duplicate) {
      showError("This exam is already in your list.");
      return;
    }

    addExam(name, selected);
    showError("");
  });

  document.addEventListener(
    "click",
    function () {
      unlockAudio();
    },
    { once: true }
  );

  loadExams();
  renderAll();
  checkPendingAlarmsOnLoad();
  setMinDate();
  setInterval(setMinDate, 60000);
})();
