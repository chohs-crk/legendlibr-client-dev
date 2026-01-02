/* ================================
   API
================================ */
import { apiFetch } from "/base/api.js";

const API = {
    check: "/create/story-check",
    story1: "/create/story1",
    story2: "/create/story2",
    story3: "/create/story3"
};


/* ================================
   DOM
================================ */
const storyBox = document.getElementById("storyBox");
const choiceBox = document.getElementById("choiceBox");
const infoArea = document.getElementById("infoArea");
const charIntro = document.getElementById("charIntro");

/* ================================
   STATE
================================ */
let currentSceneKey = null;
let collectedChoices = [];
let isPrinting = false;

// 🔴 실제 저장 기준 (UI와 무관)
let logicalStoryBuffer = "";

// ❌ UI 전용 임시 버퍼 (이제 저장에 사용 안 함)
let tempStoryBuffer = ""; // ← 남겨둬도 되지만, 저장에는 사용 안 함

let outputQueue = [];

if (!sessionStorage.getItem("story_log")) {
    sessionStorage.setItem("story_log", JSON.stringify([]));
}

/* ================================
   UTIL
================================ */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/* ================================
   CHARACTER INTRO
================================ */
function renderCharIntro() {
    const name = sessionStorage.getItem("displayNameRaw") || "";
    const intro = sessionStorage.getItem("aiIntro") || "";
    charIntro.textContent = name + (intro ? "\n" + intro : "");
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

function appendToCurrentScene(text) {
    const log = getStoryLog();
    const last = log[log.length - 1];
    if (!last) return;
    last.story += text;
    setStoryLog(log);
}

function renderStoryFromLog() {
    storyBox.textContent = "";
    const log = getStoryLog();

    for (const entry of log) {
        if (entry.story) {
            storyBox.textContent += entry.story + "\n\n";
        }
        if (entry.choice) {
            storyBox.textContent += `> ${entry.choice}\n\n`;
        }
    }

    storyBox.scrollTop = storyBox.scrollHeight;
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
    isPrinting = true;

    const tick = async () => {
        if (outputQueue.length === 0) {
            isPrinting = false;
            return;
        }

        let sentence = outputQueue.shift();

        if (storyBox.textContent.length > 0 && !sentence.startsWith(" ")) {
            sentence = " " + sentence;
        }

        for (const char of sentence) {
            storyBox.textContent += char;
            storyBox.scrollTop = storyBox.scrollHeight;
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
    collectedChoices = [];
    outputQueue = [];
    isPrinting = false;
    tempStoryBuffer = "";
    logicalStoryBuffer = ""; // 🔴 추가

    choiceBox.innerHTML = "";
    infoArea.textContent = "AI 작성 중…";
    let completed = false;

    const res = await apiFetch(API[flow], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
    });

    const ct = res.headers.get("content-type") || "";


    /* ===============================
       1️⃣ JSON 응답 처리 (★ 필수)
    =============================== */
    if (ct.includes("application/json")) {
        const j = await res.json();

        // TF 쿨타임
        if (j.status === "waiting") {
            showRetry(j.remain || 0, flow);
            return;
        }

        // 이미 완료된 경우 (TT)
        if (j.status === "done") {
            const log = getStoryLog();
            const last = log[log.length - 1];
            if (last && j.story) {
                last.story = j.story;
                setStoryLog(log);
            }

            collectedChoices = (j.choices || []).map(c => c.text);
            backupChoices(flow, collectedChoices);
            renderStoryFromLog();
            renderChoices();
            infoArea.textContent = "";
            return;
        }
    }

    /* ===============================
       2️⃣ SSE 스트리밍 (첫 호출과 동일)
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

                if (currentEvent === "choices") {
                    try {
                        const data = JSON.parse(payload);
                        collectedChoices = data.choices || [];
                        backupChoices(flow, collectedChoices);

                        // ★ 여기서만 스토리 커밋
                        const log = getStoryLog();
                        const last = log[log.length - 1];
                        if (last) {
                            last.story += logicalStoryBuffer; // 🔴 논리 기준
                            setStoryLog(log);
                        }
                        logicalStoryBuffer = "";
                        tempStoryBuffer = ""; // UI용이라 그냥 초기화


                    } catch (_) { }
                }
                else if (currentEvent === "done") {
                    completed = true;
                    renderChoices();
                }
                else {
                    const clean = payload.replace(/<[^>]*>/g, "");
                    if (clean) {
                        // 🔴 실제 저장은 여기서 즉시
                        logicalStoryBuffer += clean;

                        // UI는 별도
                        outputQueue.push(clean);
                        startPrinter(flow);
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
function renderChoices() {
    choiceBox.innerHTML = "";
    collectedChoices.forEach((text, idx) => {
        const btn = document.createElement("button");
        btn.className = "choice-btn";
        btn.textContent = text;
        btn.onclick = () => selectChoice(idx);
        choiceBox.appendChild(btn);
    });
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
    btn.disabled = true;

    let safeRemain = Math.max(1000, remain || 0);
    let left = Math.ceil(safeRemain / 1000);

    btn.textContent = `재시도까지 ${left}s`;
    choiceBox.appendChild(btn);

    const timer = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.textContent = "다시 시도";
            btn.onclick = () => {
                choiceBox.innerHTML = "";
                infoArea.textContent = "AI 재시도 중…";
                streamScene(flow, true);

            };
        } else {
            btn.textContent = `재시도까지 ${left}s`;
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
        location.href = "create-prompt.html";
        return;
    }

    if (j.intro) sessionStorage.setItem("aiIntro", j.intro);
    renderCharIntro();

    const flow = j.flow;
    if (!flow) return;

    if (flow === "final") {
        location.href = "create-final.html";
        return;
    }

    const { called, resed, remain } = j;
    const log = getStoryLog();
    const last = log[log.length - 1];

    // FF
    if (!called && !resed) {
        renderStoryFromLog();

        if (!last || last.scene !== flow) {
            log.push({ scene: flow, story: "", choice: null });
            setStoryLog(log);
        }

        streamScene(flow);
        return;
    }

    // TT
    if (called && resed) {
        currentSceneKey = flow;
        renderStoryFromLog();

        collectedChoices = JSON.parse(
            sessionStorage.getItem(choicesKey(flow)) || "[]"
        );
        renderChoices();
        return;
    }

    // TF
    if (called && !resed) {
        showRetry(remain, flow);
        return;
    }
}

/* ================================
   START
================================ */
startFlow();
