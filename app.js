const API = "";

const state = {
    flashcards: [],
    settings: { sound_enabled: true, timer_seconds: 10, theme: "light" },
    profile: { name: "", level: 1, xp: 0, best_streak: 0, current_streak: 0 },
    performance: {},

    mode: null,
    deck: [],
    index: 0,
    showingAnswer: false,

    correct: 0,
    incorrect: 0,
    cardResults: [],

    timerInterval: null,
    timeLeft: 0,

    sessionActive: false,
};

let audioCtx = null;

async function apiGet(path) {
    const res = await fetch(API + path);
    if (!res.ok) throw new Error(`GET ${path} failed`);
    return res.json();
}

async function apiPost(path, body) {
    const res = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `POST ${path} failed`);
    }
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(API + path, { method: "DELETE" });
    if (!res.ok) throw new Error(`DELETE ${path} failed`);
    return res.json();
}

// --- Guest (not logged in) data layer -------------------------------------
// Guests never hit the backend/database at all; everything lives in
// localStorage via window.auth.getGuestData()/setGuestData().

function isLoggedIn() {
    return !!(window.auth && window.auth.isLoggedIn());
}

function nextGuestCardId(cards) {
    return cards.reduce((max, c) => Math.max(max, c.id), 0) + 1;
}

async function dataGetFlashcards() {
    if (isLoggedIn()) return apiGet("/api/flashcards");
    return window.auth.getGuestData().flashcards;
}

async function dataAddFlashcard(term, translation, definition) {
    if (isLoggedIn()) return apiPost("/api/flashcards", { term, translation, definition });
    const data = window.auth.getGuestData();
    const id = nextGuestCardId(data.flashcards);
    const card = { id, term, translation, definition };
    data.flashcards.push(card);
    window.auth.setGuestData(data);
    return card;
}

async function dataDeleteFlashcard(cardId) {
    if (isLoggedIn()) return apiDelete(`/api/flashcards/${cardId}`);
    const data = window.auth.getGuestData();
    data.flashcards = data.flashcards.filter(c => c.id !== cardId);
    delete data.performance[cardId];
    window.auth.setGuestData(data);
    return { deleted: cardId };
}

async function dataImportFlashcards(cards) {
    if (isLoggedIn()) return apiPost("/api/flashcards/import", { cards });
    const data = window.auth.getGuestData();
    let nextId = nextGuestCardId(data.flashcards);
    let added = 0;
    for (const item of cards) {
        const term = (item && item.term ? item.term : "").trim();
        const translation = (item && item.translation ? item.translation : "").trim();
        const definition = (item && item.definition ? item.definition : "").trim();
        if (term && translation && definition) {
            data.flashcards.push({ id: nextId, term, translation, definition });
            nextId += 1;
            added += 1;
        }
    }
    window.auth.setGuestData(data);
    return { added, total: data.flashcards.length };
}

async function dataExportFlashcards() {
    if (isLoggedIn()) return apiGet("/api/flashcards/export");
    return window.auth.getGuestData().flashcards;
}

async function dataExportResults() {
    if (isLoggedIn()) return apiGet("/api/results/export");
    return window.auth.getGuestData().results;
}

async function dataGetSettings() {
    if (isLoggedIn()) return apiGet("/api/settings");
    return window.auth.getGuestData().settings;
}

async function dataUpdateSettings(partial) {
    if (isLoggedIn()) return apiPost("/api/settings", partial);
    const data = window.auth.getGuestData();
    data.settings = Object.assign({}, data.settings, partial);
    window.auth.setGuestData(data);
    return data.settings;
}

async function dataGetProfile() {
    if (isLoggedIn()) return apiGet("/api/profile");
    return window.auth.getGuestData().profile;
}

async function dataGetPerformance() {
    if (isLoggedIn()) return apiGet("/api/performance");
    return window.auth.getGuestData().performance;
}

async function dataGetStats() {
    if (isLoggedIn()) return apiGet("/api/stats");
    const data = window.auth.getGuestData();
    const cards = {};
    data.flashcards.forEach(c => { cards[c.id] = c; });
    const performance = {};
    Object.entries(data.performance).forEach(([id, stats]) => {
        const card = cards[id];
        if (!card) return;
        performance[id] = {
            term: card.term,
            translation: card.translation,
            definition: card.definition,
            correct: stats.correct || 0,
            incorrect: stats.incorrect || 0,
        };
    });
    return { profile: data.profile, performance, history: data.results.slice(-20) };
}

async function dataSubmitQuizResult(payload) {
    if (isLoggedIn()) return apiPost("/api/quiz/result", payload);

    const data = window.auth.getGuestData();
    const mode = payload.mode || "quiz";
    const cardResults = payload.card_results || [];
    const correct = Number(payload.correct) || 0;
    const incorrect = Number(payload.incorrect) || 0;
    const total = Number(payload.total) || (correct + incorrect);

    cardResults.forEach(item => {
        if (item.id === undefined || item.id === null) return;
        const key = String(item.id);
        const stats = data.performance[key] || { correct: 0, incorrect: 0 };
        if (item.correct) stats.correct += 1; else stats.incorrect += 1;
        data.performance[key] = stats;
    });

    let leveledUp = false;
    let xpGained = 0;
    cardResults.forEach(item => {
        if (item.correct) {
            xpGained += 15;
            data.profile.current_streak += 1;
            data.profile.best_streak = Math.max(data.profile.best_streak, data.profile.current_streak);
        } else {
            data.profile.current_streak = 0;
        }
    });
    data.profile.xp += xpGained;
    while (data.profile.xp >= data.profile.level * 100) {
        data.profile.level += 1;
        leveledUp = true;
    }

    const percentage = total ? Math.round((correct / total) * 100) : 0;
    data.results.push({
        timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
        mode,
        correct,
        incorrect,
        total,
        percentage,
        xp_gained: xpGained,
    });

    window.auth.setGuestData(data);

    return { profile: data.profile, leveled_up: leveledUp, xp_gained: xpGained, percentage };
}

function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq, duration, type = "sine") {
    if (!state.settings.sound_enabled) return;
    try {
        ensureAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
    }
}

function playCorrectSound() {
    playTone(660, 0.12);
    setTimeout(() => playTone(880, 0.18), 100);
}

function playIncorrectSound() {
    playTone(180, 0.3, "sawtooth");
}

function playTickSound() {
    playTone(1000, 0.05);
}

function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function showAlert(msg, type = "error") {
    const box = document.getElementById("alert-box");
    box.textContent = msg;
    box.className = `alert alert-${type}`;
    box.style.display = "block";
    clearTimeout(showAlert._t);
    showAlert._t = setTimeout(() => { box.style.display = "none"; }, 3000);
}

function showView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`view-${name}`).classList.add("active");
    document.querySelectorAll(".nav-link").forEach(a => {
        a.classList.toggle("active", a.dataset.view === name);
    });
    if (name === "stats") renderStats();
    if (name === "manage") renderCardList();
}

document.querySelectorAll(".nav-link").forEach(a => {
    a.addEventListener("click", (e) => {
        e.preventDefault();
        showView(a.dataset.view);
    });
});

function renderHeader() {
    if (window.auth && typeof window.auth.refreshHeader === "function") {
        window.auth.refreshHeader().catch(() => {});
    }
}


function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
    document.querySelectorAll("#theme-pill-group .pill-option").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.theme === theme);
    });
}

document.querySelectorAll("#theme-pill-group .pill-option").forEach(btn => {
    btn.addEventListener("click", async () => {
        state.settings = await dataUpdateSettings({ theme: btn.dataset.theme });
        applyTheme(state.settings.theme);
        toast("Settings saved");
    });
});

function renderSettings() {
    document.getElementById("setting-sound").checked = !!state.settings.sound_enabled;
    document.querySelectorAll("#timer-pill-group .pill-option").forEach(btn => {
        btn.classList.toggle("active", Number(btn.dataset.seconds) === state.settings.timer_seconds);
    });
    applyTheme(state.settings.theme);
}

document.getElementById("setting-sound").addEventListener("change", async (e) => {
    ensureAudio();
    state.settings = await dataUpdateSettings({ sound_enabled: e.target.checked });
    if (e.target.checked) playCorrectSound();
    toast("Settings saved");
});

document.querySelectorAll("#timer-pill-group .pill-option").forEach(btn => {
    btn.addEventListener("click", async () => {
        state.settings = await dataUpdateSettings({ timer_seconds: Number(btn.dataset.seconds) });
        renderSettings();
        toast("Settings saved");
    });
});

document.querySelectorAll(".mode-card").forEach(btn => {
    btn.addEventListener("click", () => startMode(btn.dataset.mode));
});

document.getElementById("btn-back-home").addEventListener("click", backToModes);

function backToModes() {
    stopTimer();
    state.mode = null;
    state.sessionActive = false;
    document.getElementById("mode-select").style.display = "block";
    document.getElementById("study-area").style.display = "none";
}

async function startMode(mode) {
    ensureAudio();
    state.mode = mode;
    state.sessionActive = true;
    state.index = 0;
    state.showingAnswer = false;
    state.correct = 0;
    state.incorrect = 0;
    state.cardResults = [];

    if (state.flashcards.length === 0) {
        showAlert("Add some flashcards first (Manage Cards tab).");
        return;
    }

    if (mode === "flashcards") {
        state.deck = [...state.flashcards];
        enterFlipMode();
    } else if (mode === "weak") {
        const weak = state.flashcards.filter(c => {
            const p = state.performance[c.id];
            return p && p.incorrect > 0;
        });
        if (weak.length === 0) {
            showAlert("No weak cards yet, you haven't missed any!", "success");
            return;
        }
        state.deck = weak;
        enterFlipMode();
    } else if (mode === "quiz" || mode === "practice") {
        state.deck = shuffle([...state.flashcards]);
        enterQuizMode();
    }

    document.getElementById("mode-select").style.display = "none";
    document.getElementById("study-area").style.display = "block";
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function enterFlipMode() {
    document.getElementById("flash-controls").style.display = "flex";
    document.getElementById("quiz-options").style.display = "none";
    document.getElementById("timer-wrap").style.display = "none";
    document.getElementById("stage-score").textContent = "";
    renderFlipCard();
}

function renderFlipCard() {
    const card = state.deck[state.index];
    const el = document.getElementById("stage-card-text");
    el.textContent = state.showingAnswer ? card.translation : card.term;
    el.className = "stage-card-text" + (state.showingAnswer ? " is-answer" : "");
    document.getElementById("stage-counter").textContent =
        `${state.mode === "weak" ? "Weak card" : "Card"} ${state.index + 1} of ${state.deck.length}`;
    document.getElementById("stage-hint").textContent = state.showingAnswer
        ? card.definition
        : "Click Flip to reveal the translation.";
}

document.getElementById("btn-flip").addEventListener("click", () => {
    state.showingAnswer = !state.showingAnswer;
    renderFlipCard();
});

document.getElementById("btn-next").addEventListener("click", () => {
    state.showingAnswer = false;
    state.index = (state.index + 1) % state.deck.length;
    renderFlipCard();
});

document.getElementById("btn-prev").addEventListener("click", () => {
    state.showingAnswer = false;
    state.index = (state.index - 1 + state.deck.length) % state.deck.length;
    renderFlipCard();
});

function enterQuizMode() {
    document.getElementById("flash-controls").style.display = "none";
    document.getElementById("quiz-options").style.display = "flex";
    document.getElementById("timer-wrap").style.display = state.mode === "quiz" ? "block" : "none";
    showQuestion();
}

function normalizeAnswer(str) {
    return (str || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function showQuestion() {
    if (state.index >= state.deck.length) {
        finishSession();
        return;
    }

    const card = state.deck[state.index];
    const el = document.getElementById("stage-card-text");
    el.textContent = card.term;
    el.className = "stage-card-text";
    document.getElementById("stage-hint").textContent = "Type the translation.";
    document.getElementById("stage-counter").textContent = `Question ${state.index + 1} of ${state.deck.length}`;
    document.getElementById("stage-score").textContent = `Correct ${state.correct}, incorrect ${state.incorrect}`;

    const wrap = document.getElementById("quiz-options");
    wrap.innerHTML = `
        <div class="quiz-input-row">
            <input type="text" id="quiz-answer-input" class="quiz-answer-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Your answer">
            <button class="btn btn-primary" id="quiz-submit-btn">Submit</button>
        </div>
    `;
    const input = document.getElementById("quiz-answer-input");
    const submitBtn = document.getElementById("quiz-submit-btn");

    const submit = () => submitAnswer(input.value, card);
    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit();
        }
    });
    input.focus();

    if (state.mode === "quiz") {
        startTimer();
    }
}

function startTimer() {
    stopTimer();
    state.timeLeft = state.settings.timer_seconds;
    updateTimerUI();
    state.timerInterval = setInterval(() => {
        state.timeLeft -= 1;
        if (state.timeLeft <= 3 && state.timeLeft > 0) playTickSound();
        updateTimerUI();
        if (state.timeLeft <= 0) {
            stopTimer();
            handleTimeout();
        }
    }, 1000);
}

function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}

function updateTimerUI() {
    const pct = Math.max(0, (state.timeLeft / state.settings.timer_seconds) * 100);
    document.getElementById("timer-fill").style.width = `${pct}%`;
    document.getElementById("timer-text").textContent = `${Math.max(0, state.timeLeft)}s left`;
}

function lockAnswerInput(resultClass) {
    const input = document.getElementById("quiz-answer-input");
    const submitBtn = document.getElementById("quiz-submit-btn");
    if (input) {
        input.disabled = true;
        input.classList.add(resultClass);
    }
    if (submitBtn) submitBtn.disabled = true;
}

function handleTimeout() {
    const card = state.deck[state.index];
    state.incorrect += 1;
    state.cardResults.push({ id: card.id, correct: false });
    playIncorrectSound();
    lockAnswerInput("incorrect");
    document.getElementById("stage-hint").textContent = `Time's up. Correct answer: ${card.translation}. ${card.definition}`;
    setTimeout(advanceQuestion, 1600);
}

function submitAnswer(typed, card) {
    if (!typed || !typed.trim()) return;
    stopTimer();
    const isCorrect = normalizeAnswer(typed) === normalizeAnswer(card.translation);
    state.cardResults.push({ id: card.id, correct: isCorrect });

    lockAnswerInput(isCorrect ? "correct" : "incorrect");

    if (isCorrect) {
        state.correct += 1;
        playCorrectSound();
        document.getElementById("stage-hint").textContent = card.definition;
    } else {
        state.incorrect += 1;
        playIncorrectSound();
        document.getElementById("stage-hint").textContent = `Not quite. Correct answer: ${card.translation}. ${card.definition}`;
    }
    document.getElementById("stage-score").textContent = `Correct ${state.correct}, incorrect ${state.incorrect}`;

    setTimeout(advanceQuestion, 1600);
}

function advanceQuestion() {
    if (!state.sessionActive) return;
    state.index += 1;
    showQuestion();
}

async function finishSession() {
    if (!state.sessionActive) return;
    document.getElementById("quiz-options").style.display = "none";
    document.getElementById("timer-wrap").style.display = "none";
    const total = state.deck.length;
    const pct = total ? Math.round((state.correct / total) * 100) : 0;

    const el = document.getElementById("stage-card-text");
    el.className = "stage-card-text";
    el.textContent = `Session complete, ${pct}%`;
    document.getElementById("stage-hint").textContent = `${state.correct} correct, ${state.incorrect} incorrect out of ${total}`;
    document.getElementById("stage-counter").textContent = "";

    try {
        const result = await dataSubmitQuizResult({
            mode: state.mode || "quiz",
            correct: state.correct,
            incorrect: state.incorrect,
            total,
            card_results: state.cardResults,
        });
        state.profile = result.profile;
        renderHeader();
        await loadPerformance();
        if (result.leveled_up) toast(`Level up! You're now level ${state.profile.level}`);
        else toast(`Saved, plus ${result.xp_gained} XP`);
    } catch (e) {
        showAlert("Could not save your results: " + e.message);
    }
}

document.getElementById("btn-add-card").addEventListener("click", async () => {
    const term = document.getElementById("new-term").value.trim();
    const translation = document.getElementById("new-translation").value.trim();
    const definition = document.getElementById("new-definition").value.trim();
    if (!term || !translation || !definition) {
        showAlert("Term, translation, and definition are all required.");
        return;
    }
    try {
        await dataAddFlashcard(term, translation, definition);
        document.getElementById("new-term").value = "";
        document.getElementById("new-translation").value = "";
        document.getElementById("new-definition").value = "";
        await loadFlashcards();
        renderCardList();
        showAlert("Flashcard added!", "success");
    } catch (e) {
        showAlert(e.message);
    }
});

function renderCardList() {
    const wrap = document.getElementById("card-list");
    wrap.innerHTML = "";
    if (state.flashcards.length === 0) {
        wrap.innerHTML = `<div class="empty-state">No flashcards yet. Add one above.</div>`;
        return;
    }
    state.flashcards.forEach(card => {
        const row = document.createElement("div");
        row.className = "card-list-row";
        row.innerHTML = `
            <div>
                <span class="card-term">${escapeHtml(card.term)}</span>
                <span class="card-translation">${escapeHtml(card.translation)}</span>
                <span class="card-definition">${escapeHtml(card.definition)}</span>
            </div>
        `;
        const del = document.createElement("button");
        del.className = "btn-remove";
        del.textContent = "Remove";
        del.addEventListener("click", async () => {
            await dataDeleteFlashcard(card.id);
            await loadFlashcards();
            await loadPerformance();
            renderCardList();
        });
        row.appendChild(del);
        wrap.appendChild(row);
    });
}

document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const cards = JSON.parse(text);
        const res = await dataImportFlashcards(cards);
        await loadFlashcards();
        renderCardList();
        showAlert(`Imported ${res.added} flashcards.`, "success");
    } catch (err) {
        showAlert("Could not import file: " + err.message);
    }
    e.target.value = "";
});

document.getElementById("btn-export-cards").addEventListener("click", () => {
    downloadJson(dataExportFlashcards, "flashcards.json");
});

document.getElementById("btn-export-results").addEventListener("click", () => {
    downloadJson(dataExportResults, "quiz_results.json");
});

async function downloadJson(fetchFn, filename) {
    const data = await fetchFn();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function renderStats() {
    document.getElementById("stat-level").textContent = state.profile.level;
    document.getElementById("stat-xp").textContent = state.profile.xp;
    document.getElementById("stat-streak").textContent = state.profile.best_streak;
    document.getElementById("stat-cards").textContent = state.flashcards.length;

    const perfWrap = document.getElementById("perf-list");
    perfWrap.innerHTML = "";
    const entries = Object.entries(state.performance);
    if (entries.length === 0) {
        perfWrap.innerHTML = `<div class="empty-state">No quiz attempts yet.</div>`;
    } else {
        entries.forEach(([id, p]) => {
            const total = p.correct + p.incorrect;
            const acc = total ? Math.round((p.correct / total) * 100) : 0;
            const row = document.createElement("div");
            row.className = "perf-row";
            row.innerHTML = `
                <div class="perf-row-top">
                    <span class="perf-term">${escapeHtml(p.term)}</span>
                    <span class="perf-translation">${escapeHtml(p.translation)}</span>
                    <span class="perf-accuracy">${total ? acc + "%" : "no data"}</span>
                </div>
                <div class="perf-definition">${escapeHtml(p.definition)}</div>
                <div class="progress-bar"><div class="progress-fill" style="width:${acc}%; background:${acc >= 70 ? '#22c55e' : acc >= 40 ? '#f59e0b' : '#ef4444'}"></div></div>
            `;
            perfWrap.appendChild(row);
        });
    }

    loadHistory();
}

async function loadHistory() {
    const stats = await dataGetStats();
    const wrap = document.getElementById("history-list");
    wrap.innerHTML = "";
    const history = [...stats.history].reverse();
    if (history.length === 0) {
        wrap.innerHTML = `<div class="empty-state">No sessions recorded yet.</div>`;
        return;
    }
    history.forEach(h => {
        const pct = Math.max(0, Math.min(100, h.percentage));
        const barColor = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
        const row = document.createElement("div");
        row.className = "history-row";
        row.innerHTML = `
            <div class="history-row-top">
                <span class="history-mode">${escapeHtml(h.mode)}</span>
                <span class="history-timestamp">${escapeHtml(h.timestamp)}</span>
            </div>
            <div class="history-row-bottom">
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${barColor}"></div></div>
                <span class="history-percentage">${pct}%</span>
                <span class="history-detail">${h.correct}/${h.total}, plus ${h.xp_gained} XP</span>
            </div>
        `;
        wrap.appendChild(row);
    });
}

async function loadFlashcards() {
    state.flashcards = await dataGetFlashcards();
}

async function loadPerformance() {
    state.performance = await dataGetPerformance();
}

function renderAccountStatus(username) {
    const el = document.getElementById("account-status");
    const btn = document.getElementById("account-btn");
    if (username) {
        el.textContent = `Signed in as ${username}`;
        btn.textContent = "Account";
    } else {
        el.textContent = "Guest session";
        btn.textContent = "Account";
    }
}

async function init() {
    try {
        [state.flashcards, state.settings, state.profile, state.performance] = await Promise.all([
            dataGetFlashcards(),
            dataGetSettings(),
            dataGetProfile(),
            dataGetPerformance(),
        ]);
        renderHeader();
        renderSettings();
        renderCardList();
        renderAccountStatus(window.auth.current());
    } catch (e) {
    }
}

init();