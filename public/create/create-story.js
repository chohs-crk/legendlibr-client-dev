/* ================================
   API
================================ */
import { apiFetch } from "/base/api.js";

const API = {
    check: "/create/story-check",
    story1: "/create/story1",
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
let completed = false;
let currentSceneKey = null;
let collectedChoices = [];
let isPrinting = false;
// ================================
// STREAM EMPHASIS STATE
// ================================
let emPendingStar = false;   // '*' 하나가 들어온 상태
let emActive = false;        // 현재 강조 상태
let talkActive = false; // 대사 상태

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
function parseStaticStory(text) {
    if (!text) return "";

    return text
        // 대사
        .replace(/§([^§]+?)§/g, `"${"$1"}"`)
        // 강조
        .replace(/\*\*(.+?)\*\*/g, `<span class="story-em">$1</span>`);
}

function renderCharIntro() {
    const name = sessionStorage.getItem("displayNameRaw") || "";
    const intro = sessionStorage.getItem("aiIntro") || "";

    charIntro.innerHTML = "";

    if (name) {
        const nameDiv = document.createElement("div");
        nameDiv.textContent = name;
        charIntro.appendChild(nameDiv);
    }

    if (intro) {
        const introDiv = document.createElement("div");
        introDiv.innerHTML = parseStaticStory(intro);
        charIntro.appendChild(introDiv);
    }
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
function parseStreamForUI(text) {
    const result = [];

    for (const ch of text) {

        // ===== 대사 마커 =====
        if (ch === "§") {
            talkActive = !talkActive;

            // 열릴 때 "
            if (talkActive) {
                result.push({ char: `"`, em: false });
            }
            // 닫힐 때 "
            else {
                result.push({ char: `"`, em: false });
            }
            continue;
        }

        // ===== 강조 마커 =====
        if (ch === "*") {
            if (!emPendingStar) {
                emPendingStar = true;
            } else {
                emPendingStar = false;
                emActive = !emActive;
            }
            continue;
        }

        if (emPendingStar) {
            emPendingStar = false;
        }

        result.push({
            char: ch,
            em: emActive
        });
    }

    return result;
}


function renderStoryFromLog() {
    storyBox.textContent = "";
    const log = getStoryLog();

    for (const entry of log) {
        if (entry.story) {
            const tokens = parseStreamForUI(entry.story);

            for (const token of tokens) {
                if (token.em) {
                    const span = document.createElement("span");
                    span.className = "story-em";
                    span.textContent = token.char;
                    storyBox.appendChild(span);
                } else {
                    storyBox.append(token.char);
                }
            }

            storyBox.append("\n\n");
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
            if (completed && collectedChoices.length > 0) {
                renderChoices();
            }
            return;
        }

        let sentence = outputQueue.shift();

        // 🔧 sentence는 이제 배열이므로 startsWith 불가
        // 👉 첫 토큰이 공백 문자인지만 확인
        if (
            storyBox.textContent.length > 0 &&
            sentence.length > 0 &&
            sentence[0].char !== " "
        ) {
            // 앞에 공백 토큰 하나 추가
            sentence.unshift({ char: " ", em: false });
        }


        for (const token of sentence) {
            if (typeof token === "string") {
                storyBox.append(token);
            } else {
                if (token.em) {
                    const span = document.createElement("span");
                    span.className = "story-em";
                    span.textContent = token.char;
                    storyBox.appendChild(span);
                } else {
                    storyBox.append(token.char);
                }
            }

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
                if (currentEvent === "error") {
                    alert("스토리 생성 중 오류가 발생했습니다.");
                    sessionStorage.removeItem("story_log");
                    location.href = "/";

                    return;
                }

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
           
                }
                else {
                    const clean = payload
                             .replace(/<[^>]*>/g, "")
                             
                    if (clean) {
                        // 🔴 저장은 원문 그대로
                        logicalStoryBuffer += clean;

                        // 🔵 UI는 강조 파싱 후 토큰 단위로
                        const tokens = parseStreamForUI(clean);
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
        alert("캐릭터 생성이 종료되었습니다.\n새로 생성할 수 있습니다.");
        location.href = "/";

        return;
    }


    if (j.intro) sessionStorage.setItem("aiIntro", j.intro);
    renderCharIntro();

    const flow = j.flow;
    if (!flow) return;

    if (flow === "final") {
        // 🔴 final 진입 시 클라이언트 스토리 상태 정리
        sessionStorage.removeItem("story_log");
        sessionStorage.removeItem("choices_backup_story1");

        sessionStorage.removeItem("choices_backup_story3");
        sessionStorage.removeItem("currentSceneKey");

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
history.replaceState(null, "", "/create");
startFlow();
