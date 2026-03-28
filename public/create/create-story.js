/* ================================
   API
================================ */
import { apiFetch } from "/base/api.js";

const API = {
    check: "/create/story-check",
    story1: "/create/story1",
    story3: "/create/story3"
};

const INTRO_ANIMATED_KEY = "create_story_intro_animated";


/* ================================
   DOM
================================ */
const storyBox = document.getElementById("storyBox");
const choiceBox = document.getElementById("choiceBox");
const infoArea = document.getElementById("infoArea");
const charIntro = document.getElementById("charIntro");
const charName = document.getElementById("charName");
const createScroll = document.getElementById("createScroll");

// 스크롤은 페이지의 단일 스크롤 영역에서 처리
const scrollRoot = createScroll || storyBox;


/* ================================
   STATE
================================ */
let completed = false;
let currentSceneKey = null;
let collectedChoices = [];
let isPrinting = false;
let outputQueue = [];

function createParseState() {
    return {
        emPendingStar: false,
        emActive: false,
        talkActive: false
    };
}

function resetParseState(state) {
    state.emPendingStar = false;
    state.emActive = false;
    state.talkActive = false;
}

const streamParseState = createParseState();

// 실제 저장 기준 (UI와 무관)
let logicalStoryBuffer = "";

// UI 전용 임시 버퍼
let tempStoryBuffer = "";


// ================================
// SCROLL FOLLOW (AUTO)
// ================================
const FOLLOW_BOTTOM_PX = 30;
let followScroll = true;

function distanceFromBottom(el) {
    return el.scrollHeight - (el.scrollTop + el.clientHeight);
}

function updateFollowScroll() {
    if (!scrollRoot) return;
    followScroll = distanceFromBottom(scrollRoot) <= FOLLOW_BOTTOM_PX;
}

function scrollToBottom() {
    if (!scrollRoot) return;
    scrollRoot.scrollTop = scrollRoot.scrollHeight;
}

if (scrollRoot) {
    scrollRoot.addEventListener("scroll", updateFollowScroll, { passive: true });
    updateFollowScroll();
}


// ================================
// CHOICES UI STATE
// ================================
let choicesRendered = false;
let isRevealingChoices = false;

function maybeRevealChoices() {
    if (choicesRendered) return;
    if (isRevealingChoices) return;
    if (!completed) return;
    if (isPrinting) return;
    if (outputQueue.length !== 0) return;
    if (!collectedChoices || collectedChoices.length === 0) return;

    renderChoicesStaggered();
}

if (!sessionStorage.getItem("story_log")) {
    sessionStorage.setItem("story_log", JSON.stringify([]));
}


/* ================================
   UTIL
================================ */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function normalizeChoices(list) {
    return (list || [])
        .map(c => {
            if (typeof c === "string") return c;
            if (c && typeof c === "object" && "text" in c) return String(c.text ?? "");
            return String(c ?? "");
        })
        .map(s => s.trim())
        .filter(Boolean);
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseTextToTokens(text, state = createParseState()) {
    const result = [];

    for (const ch of text || "") {
        if (ch === "§") {
            state.talkActive = !state.talkActive;
            result.push({ char: '"', em: false });
            continue;
        }

        if (ch === "*") {
            if (!state.emPendingStar) {
                state.emPendingStar = true;
            } else {
                state.emPendingStar = false;
                state.emActive = !state.emActive;
            }
            continue;
        }

        if (ch === "$") {
            if (state.emPendingStar) {
                state.emPendingStar = false;
            }
            state.emActive = !state.emActive;
            continue;
        }

        if (state.emPendingStar) {
            state.emPendingStar = false;
        }

        result.push({
            char: ch,
            em: state.emActive
        });
    }

    return result;
}

function tokensToHTML(tokens) {
    return (tokens || [])
        .map(token => {
            const safeChar = escapeHtml(token.char);
            return token.em
                ? `<span class="story-em">${safeChar}</span>`
                : safeChar;
        })
        .join("");
}

function parseStaticRichText(text) {
    const localState = createParseState();
    return tokensToHTML(parseTextToTokens(text || "", localState));
}

function appendToken(target, token) {
    if (!target || !token) return;

    if (token.em) {
        const span = document.createElement("span");
        span.className = "story-em";
        span.textContent = token.char;
        target.appendChild(span);
        return;
    }

    target.append(token.char);
}

function buildSelectedChoiceNode(text) {
    const wrap = document.createElement("div");
    wrap.className = "selected-choice";
    wrap.innerHTML = `<div class="selected-choice__text">${parseStaticRichText(text)}</div>`;
    return wrap;
}

async function typeTextIntoElement(target, text, speed = 14) {
    if (!target) return;

    target.innerHTML = "";
    const localState = createParseState();
    const tokens = parseTextToTokens(text || "", localState);

    for (const token of tokens) {
        appendToken(target, token);

        if (followScroll) {
            scrollToBottom();
        }

        await sleep(speed);
    }
}


/* ================================
   CHARACTER INTRO
================================ */
function renderCharName() {
    if (!charName) return;
    charName.textContent = sessionStorage.getItem("displayNameRaw") || "";
}

function renderCharIntroInstant() {
    if (!charIntro) return;
    const intro = sessionStorage.getItem("aiIntro") || "";
    charIntro.innerHTML = intro ? parseStaticRichText(intro) : "";
}

async function renderCharIntroAnimated() {
    const intro = sessionStorage.getItem("aiIntro") || "";

    if (!intro) {
        if (charIntro) charIntro.innerHTML = "";
        sessionStorage.setItem(INTRO_ANIMATED_KEY, "1");
        return;
    }

    await typeTextIntoElement(charIntro, intro, 16);
    sessionStorage.setItem(INTRO_ANIMATED_KEY, "1");
}

async function ensureCharIntro(flow, animate = false) {
    if (flow === "story1" && animate && sessionStorage.getItem(INTRO_ANIMATED_KEY) !== "1") {
        await renderCharIntroAnimated();
        return;
    }

    renderCharIntroInstant();
}


/* ================================
   STORY LOG (sessionStorage)
================================ */
function getStoryLog() {
    return JSON.parse(sessionStorage.getItem("story_log") || "[]");
}

function setStoryLog(log) {
    sessionStorage.setItem("story_log", JSON.stringify(log));
}

function renderStoryFromLog() {
    const prevScrollTop = scrollRoot ? scrollRoot.scrollTop : 0;
    const wasNearBottom = scrollRoot ? (distanceFromBottom(scrollRoot) <= FOLLOW_BOTTOM_PX) : true;

    storyBox.innerHTML = "";
    const log = getStoryLog();
    const renderState = createParseState();

    for (const entry of log) {
        if (entry.story) {
            const tokens = parseTextToTokens(entry.story, renderState);

            for (const token of tokens) {
                appendToken(storyBox, token);
            }

            storyBox.append("\n\n");
        }

        if (entry.choice) {
            storyBox.appendChild(buildSelectedChoiceNode(entry.choice));
            storyBox.append("\n\n");
        }
    }

    if (!scrollRoot) return;

    if (wasNearBottom) {
        followScroll = true;
        scrollToBottom();
    } else {
        const maxTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
        scrollRoot.scrollTop = Math.min(prevScrollTop, maxTop);
        updateFollowScroll();
    }
}


/* ================================
   CHOICES BACKUP
================================ */
function choicesKey(flow) {
    return `choices_backup_${flow}`;
}

function backupChoices(flow, choices) {
    sessionStorage.setItem(choicesKey(flow), JSON.stringify(choices || []));
}


/* ================================
   TYPING EFFECT
================================ */
function startPrinter(flow) {
    if (isPrinting) return;

    updateFollowScroll();
    isPrinting = true;

    const tick = async () => {
        if (outputQueue.length === 0) {
            isPrinting = false;
            maybeRevealChoices();
            return;
        }

        let sentence = outputQueue.shift();

        if (
            storyBox.textContent.length > 0 &&
            sentence.length > 0 &&
            sentence[0].char !== " "
        ) {
            sentence.unshift({ char: " ", em: false });
        }

        for (const token of sentence) {
            appendToken(storyBox, token);

            if (followScroll) {
                scrollToBottom();
            }

            await sleep(10);
        }

        setTimeout(tick, 50);
    };

    tick();
}


/* ================================
   SSE STREAM
================================ */
async function streamScene(flow, force = false) {
    currentSceneKey = flow;

    completed = false;
    collectedChoices = [];
    outputQueue = [];
    isPrinting = false;
    choicesRendered = false;
    isRevealingChoices = false;

    tempStoryBuffer = "";
    logicalStoryBuffer = "";

    resetParseState(streamParseState);

    choiceBox.innerHTML = "";
    infoArea.textContent = "AI 작성 중…";

    updateFollowScroll();

    const res = await apiFetch(API[flow], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
    });

    const ct = res.headers.get("content-type") || "";


    /* ===============================
       1️⃣ JSON 응답 처리
    =============================== */
    if (ct.includes("application/json")) {
        const j = await res.json();

        if (j.status === "waiting") {
            showRetry(j.remain || 0, flow);
            return;
        }

        if (j.status === "done") {
            const log = getStoryLog();
            const last = log[log.length - 1];
            if (last && j.story) {
                last.story = j.story;
                setStoryLog(log);
            }

            collectedChoices = normalizeChoices(j.choices);
            backupChoices(flow, collectedChoices);

            renderStoryFromLog();
            renderChoicesStaggered();
            infoArea.textContent = "";
            return;
        }
    }

    /* ===============================
       2️⃣ SSE 스트리밍
    =============================== */
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;

            if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
                continue;
            }

            if (line.startsWith("data:")) {
                const payload = line.slice(5);
                if (!payload) continue;

                if (currentEvent === "error") {
                    alert("스토리 생성 중 오류가 발생했습니다.");
                    sessionStorage.removeItem("story_log");
                    location.href = "/";
                    return;
                }

                if (currentEvent === "choices") {
                    try {
                        const data = JSON.parse(payload);
                        collectedChoices = normalizeChoices(data.choices);
                        backupChoices(flow, collectedChoices);

                        const log = getStoryLog();
                        const last = log[log.length - 1];
                        if (last) {
                            last.story += logicalStoryBuffer;
                            setStoryLog(log);
                        }

                        logicalStoryBuffer = "";
                        tempStoryBuffer = "";

                        maybeRevealChoices();
                    } catch (_) { }
                }
                else if (currentEvent === "done") {
                    completed = true;
                    maybeRevealChoices();
                }
                else {
                    const clean = payload.replace(/<[^>]*>/g, "");

                    if (clean) {
                        logicalStoryBuffer += clean;
                        tempStoryBuffer += clean;

                        const tokens = parseTextToTokens(clean, streamParseState);
                        if (tokens.length > 0) {
                            outputQueue.push(tokens);
                            startPrinter(flow);
                        }
                    }
                }
            }
        }
    }

    if (completed) {
        infoArea.textContent = "";
    }
}


/* ================================
   CHOICES
================================ */
async function renderChoicesStaggered() {
    if (choicesRendered) return;
    if (isRevealingChoices) return;

    choicesRendered = true;
    isRevealingChoices = true;

    choiceBox.innerHTML = "";

    for (let idx = 0; idx < collectedChoices.length; idx++) {
        const text = collectedChoices[idx];

        const btn = document.createElement("button");
        btn.className = "choice-btn is-hidden";
        btn.type = "button";
        btn.innerHTML = `<span class="choice-btn__text">${parseStaticRichText(text)}</span>`;
        btn.onclick = () => selectChoice(idx);

        choiceBox.appendChild(btn);

        requestAnimationFrame(() => {
            btn.classList.remove("is-hidden");
        });

        if (followScroll) {
            scrollToBottom();
        }

        await sleep(300);
    }

    isRevealingChoices = false;
}


/* ================================
   SELECT CHOICE
================================ */
async function selectChoice(index) {
    const log = getStoryLog();
    const last = log[log.length - 1];

    if (last && collectedChoices[index]) {
        last.choice = collectedChoices[index];
        setStoryLog(log);
    }

    await apiFetch(API[currentSceneKey], {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index })
    });

    await startFlow();
}


/* ================================
   RETRY UX
================================ */
function showRetry(remain, flow) {
    renderStoryFromLog();
    choiceBox.innerHTML = "";

    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.type = "button";
    btn.disabled = true;

    let safeRemain = Math.max(1000, remain || 0);
    let left = Math.ceil(safeRemain / 1000);

    btn.innerHTML = `<span class="choice-btn__text">재시도까지 ${left}s</span>`;
    choiceBox.appendChild(btn);

    const timer = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.innerHTML = '<span class="choice-btn__text">다시 시도</span>';
            btn.onclick = () => {
                choiceBox.innerHTML = "";
                infoArea.textContent = "AI 재시도 중…";
                streamScene(flow, true);
            };
        } else {
            btn.innerHTML = `<span class="choice-btn__text">재시도까지 ${left}s</span>`;
        }
    }, 1000);
}


/* ================================
   FLOW CONTROL
================================ */
async function startFlow() {
    const res = await apiFetch(API.check);
    const j = await res.json();

    if (!j.ok) {
        alert("캐릭터 생성이 종료되었습니다.\n새로 생성할 수 있습니다.");
        location.href = "/";
        return;
    }

    if (j.intro) sessionStorage.setItem("aiIntro", j.intro);
    renderCharName();

    const flow = j.flow;
    if (!flow) {
        renderCharIntroInstant();
        return;
    }

    if (flow === "final") {
        sessionStorage.removeItem("story_log");
        sessionStorage.removeItem("choices_backup_story1");
        sessionStorage.removeItem("choices_backup_story3");
        sessionStorage.removeItem("currentSceneKey");
        sessionStorage.removeItem(INTRO_ANIMATED_KEY);
        location.href = "/creating";
        return;
    }

    const { called, resed, remain } = j;
    const log = getStoryLog();
    const last = log[log.length - 1];
    const isNewScene = !last || last.scene !== flow;

    if (!called && !resed) {
        renderStoryFromLog();

        if (isNewScene) {
            log.push({ scene: flow, story: "", choice: null });
            setStoryLog(log);
        }

        if (flow === "story1" && isNewScene) {
            sessionStorage.removeItem(INTRO_ANIMATED_KEY);
        }

        await ensureCharIntro(flow, flow === "story1" && isNewScene);
        streamScene(flow);
        return;
    }

    if (called && resed) {
        currentSceneKey = flow;
        await ensureCharIntro(flow, false);
        renderStoryFromLog();

        collectedChoices = normalizeChoices(
            JSON.parse(sessionStorage.getItem(choicesKey(flow)) || "[]")
        );
        choicesRendered = false;
        isRevealingChoices = false;
        renderChoicesStaggered();
        return;
    }

    if (called && !resed) {
        await ensureCharIntro(flow, false);
        showRetry(remain, flow);
        return;
    }
}


/* ================================
   START
================================ */
history.replaceState(null, "", "/create-story");
startFlow();
