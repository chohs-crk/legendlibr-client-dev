// ==============================
// ✅ battle-controller 최종 완성본
// ==============================

const battleId = sessionStorage.getItem("battleId");
if (!battleId) {
    alert("전투 정보가 없습니다.");
    location.href = "/base/journey.html";
}

// ✅ 상태
let currentTurn = 1;
let maxTurns = 3;


let myName = "";
let enemyName = "";
let skillMap = {};       // { 0: "기본 공격", 1: "방어", 2: "돌진", 3: "필살기" }
let currentChoices = [];

// ✅ DOM
const storyBox = document.getElementById("storyContainer");
const skillBox = document.getElementById("skillButtons");
const turnInfo = document.getElementById("turnInfo");
const vsText = document.getElementById("vsText");
const btnGiveUp = document.getElementById("btnGiveUp");
const btnHome = document.getElementById("btnHome");
const loadingOverlay = document.getElementById("loadingOverlay");
const btnTopHome = document.getElementById("btnTopHome");
// ✅ API
const TURN_API = "https://ai-proxy2.vercel.app/api/battle/battle-turn";
const LOG_API = "https://ai-proxy2.vercel.app/api/battle/battle-log";

// ==============================
// ✅ 공용 UI
// ==============================

function showLoading() {
    loadingOverlay.style.display = "flex";
}
function hideLoading() {
    loadingOverlay.style.display = "none";
}
function applyWinnerHighlight(winnerName) {
    if (!winnerName) return;

    if (winnerName === myName) {
        vsText.innerHTML = `<span class="winner">${myName}</span> VS ${enemyName}`;
    } else if (winnerName === enemyName) {
        vsText.innerHTML = `${myName} VS <span class="winner">${enemyName}</span>`;
    }
}

function appendStory(title, text) {
    const div = document.createElement("div");
    div.className = "battle-log";

    // ✅ 여기서 parseStoryText 적용
    const parsed = parseStoryText(text);

    div.innerHTML = `<b>▶ ${title}</b><br>${parsed}`;
    storyBox.appendChild(div);
}

function parseStoryText(raw) {
    if (!raw) return "";
    let html = String(raw);

    html = html.replace(/story-(em|talk|skill)\"?>/gi, "");
    html = html.replace(/<span[^>]*>/gi, "");
    html = html.replace(/<\/span>/gi, "");
    html = html.replace(/&lt;\/?span[^&]*&gt;/gi, "");

    // ✅ **중요 강조**
    html = html.replace(/\*\*(.+?)\*\*/g, (_, txt) =>
        `<span class="story-em">${txt}</span>`
    );

    // ✅ 대사 강조: §대사§ 형식 (최종 안전 버전)
    html = html.replace(/§([^§]+?)§/g, (_, txt) =>
        `"${'<span class="story-talk">' + txt + '</span>'}"`
    );


    // ✅ 『스킬명』 강조
    html = html.replace(/『(.+?)』/g, (_, txt) =>
        `『<span class="story-skill">${txt}</span>』`
    );

    html = html.replace(/\r\n/g, "\n");
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/(<br>\s*){3,}/g, "<br><br>");

    return html.trim();
}

async function initBattle() {

    showLoading();

    const res = await fetch(TURN_API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ battleId, mode: "load" })
    });


    const data = await res.json();
    hideLoading();

    if (!data.ok) {
        alert("전투 불러오기 실패");
        location.href = "/base/journey.html";
        return;
    }

    // ✅ VS
    myName = data.vs.myName;
    enemyName = data.vs.enemyName;
    renderVS();

    // ✅ 스킬맵
    skillMap = data.skillMap || {};

    // ✅ 현재 턴 동기화
    currentTurn = data.turn || 1;
    renderTurnInfo();

    // ✅ 기존 로그 전부 출력
    (data.history || []).forEach(l => {
        appendStory(l.skillAName, l.narration || "");
    });

    // ✅ 다음 선택지
    currentChoices = data.nextChoices || [];
    renderSkillButtons();

}
function renderTurnInfo() {
    turnInfo.textContent = `턴 ${currentTurn} / ${maxTurns}`;
}

function renderVS() {
    vsText.textContent = `${myName} VS ${enemyName}`;
}

// ==============================
// ✅ 스킬 버튼 렌더 (이름 표시)
// ==============================

function renderSkillButtons() {
    skillBox.innerHTML = "";

    currentChoices.forEach(idx => {
        const btn = document.createElement("button");
        btn.textContent = skillMap[idx] || `스킬 ${idx + 1}`;
        btn.onclick = () => handleSelectSkill(idx);
        skillBox.appendChild(btn);
    });
}

// ==============================
// ✅ 핵심: 서버로 턴 요청
// ==============================
function disableSkillButtons() {
    const buttons = skillBox.querySelectorAll("button");
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.pointerEvents = "none";
    });
}

let isProcessingTurn = false;   // ✅ 파일 최상단에 추가

async function handleSelectSkill(mySkillIndex) {
    if (isProcessingTurn) return;   // ✅ 중복 클릭 차단
    isProcessingTurn = true;

    showLoading();
    disableSkillButtons();         // ✅ 모든 선택지 비활성화

    try {
        const res = await fetch(TURN_API, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ battleId, mySkillIndex })
        });


        const data = await res.json();

        if (!data.ok) {
            alert("전투 처리 실패");
            return;
        }

        appendStory(data.usedSkillName, data.narration);

        currentChoices = data.nextChoices || [];

        if (data.finished) {
            applyWinnerHighlight(data.winnerName);
            finishBattle();                 // ✅ 여기서 선택지 박스 완전 제거됨
        } else {
            renderSkillButtons();           // ✅ 다음 선택지 정상 출력
        }

        currentTurn++;
        renderTurnInfo();

    } catch (err) {
        console.error(err);
        alert("서버 통신 오류");
    } finally {
        hideLoading();              // ✅ 로그+선택지 다 받은 뒤에만 로딩 제거
        isProcessingTurn = false;   // ✅ 다시 클릭 가능
    }
}


        


// ==============================
// ✅ 전투 종료 처리
// ==============================

function finishBattle() {
    skillBox.innerHTML = "";
    skillBox.style.display = "none";   // ✅ 박스 자체 완전 제거

    btnGiveUp.style.display = "none";
    btnHome.style.display = "block";
}


// ==============================
// ✅ 버튼 이벤트
// ==============================

btnGiveUp.onclick = async () => {
    const isConfirm = confirm("정말 전투를 포기하시겠습니까?\n패배로 처리됩니다.");
    if (!isConfirm) return;

    const battleId = sessionStorage.getItem("battleId");

    // 🔥 battleId만 필수
    if (!battleId) {
        alert("전투 정보가 없습니다.");
        location.href = "/base/index.html";
        return;
    }

    try {
        const res = await fetch("https://ai-proxy2.vercel.app/api/battle/battle-turn", {
            method: "POST",
            credentials: "include",   // 🔥 세션 쿠키 자동 포함
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                mode: "giveup",
                battleId
            })
        });

        const data = await res.json();
        console.log("✅ GIVEUP RESULT:", data);

        if (!data.ok) {
            alert("포기 처리 실패");
            return;
        }

    } catch (e) {
        console.warn("⚠️ 포기 처리 중 서버 오류");
        alert("서버 오류로 포기 처리에 실패했습니다.");
        return;
    }

    // 🔥 포기 성공 시 홈으로 이동
    location.href = "/base/index.html";
};





btnTopHome.onclick = () => {
    location.href = "/base/index.html";
};
btnHome.onclick = () => {
    location.href = "/base/journey.html";
};

// ==============================
// ✅ 초기 UI
// ==============================

renderTurnInfo();
initBattle();   // ✅ 이 줄이 없어서 지금 멈춰 있었음

