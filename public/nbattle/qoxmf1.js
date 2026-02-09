const $ = (s) => document.querySelector(s);

// ===== DOM =====
const btnBack = $("#btnBack");
const myCharSelect = $("#myCharSelect");
const myCharNameEl = $("#myCharName");
const btnViewMy = $("#btnViewMy");
const enemyNameEl = $("#enemyName");
const btnViewEnemy = $("#btnViewEnemy");
const btnStartBattle = $("#btnStartBattle");

// ===== 상태 =====
let myCharacters = [];
let selectedMyId = null;
let enemyChar = null;

// ✅ 서버 API
const API = "https://ai-proxy2.vercel.app/api/battle/battle";

// ==============================
// ✅ 전투 생성
// ==============================
let isMatching = false;   // ✅ 전역 플래그 추가

async function requestMatchOrCreate() {
    if (isMatching) return;   // ✅ 중복 차단
    isMatching = true;

    try {
        const token = await window._fb.auth.currentUser.getIdToken();

        const res = await fetch(API, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include",

            body: JSON.stringify({
                action: "matchOrCreate",
                myId: selectedMyId
            })
        });

        const data = await res.json();

        if (!data.enemy || !data.enemy.id) {
            enemyChar = null;
            updateEnemyPreview();
            return;
        }

        enemyChar = data.enemy;
        updateEnemyPreview();

        if (data.battleId) {
            sessionStorage.setItem("battleId", data.battleId);
        }
    } finally {
        isMatching = false;  // ✅ 반드시 해제
    }
}



   


// ==============================
// ✅ 렌더
// ==============================
function updateMyCharPreview() {
    const c = myCharacters.find(c => c.id === selectedMyId);

    if (!c) {
        myCharNameEl.textContent = "(선택된 캐릭터 없음)";
        btnViewMy.disabled = true;   // ✅ 캐릭 없으면 비활성화
        return;
    }

    myCharNameEl.textContent = `선택된 캐릭터: ${c.name}`;
    btnViewMy.disabled = false;     // ✅ ✅ ✅ 여기서 활성화됨 (핵심)
}


function updateEnemyPreview() {
    if (!enemyChar || !enemyChar.id) {
        enemyNameEl.textContent = "(매칭 대기 중...)";
        btnViewEnemy.disabled = true;
        btnStartBattle.disabled = true;
        return;
    }

    enemyNameEl.textContent = `매칭된 상대: ${enemyChar.name}`;
    btnViewEnemy.disabled = false;

    // ✅ 버튼은 enemy 기준으로만 활성화
    btnStartBattle.disabled = false;
}

// ==============================
// ✅ 준비 로드
// ==============================
async function loadBattlePrepare() {
    const token = await window._fb.auth.currentUser.getIdToken();

    const res = await fetch(API, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json"
        },
        credentials: "include",

        body: JSON.stringify({ action: "prepare" })
    });

    const data = await res.json();

    myCharacters = data.myCharacters || [];
    selectedMyId = data.selectedMyId || myCharacters[0]?.id || null;

    

    myCharSelect.innerHTML = "";
    myCharacters.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        myCharSelect.appendChild(opt);
    });

    myCharSelect.value = selectedMyId;

    updateMyCharPreview();
    updateEnemyPreview();
}



// ==============================
// ✅ 이벤트
// ==============================
btnBack.onclick = () => location.href = "/base/journey.html";

myCharSelect.onchange = async (e) => {
    selectedMyId = e.target.value;

    // ✅ 이전 캐릭터 battle 폐기 (프론트 기준)
    sessionStorage.removeItem("battleId");

    enemyChar = null;
    updateMyCharPreview();
    updateEnemyPreview();

    await requestMatchOrCreate();
};


btnViewMy.onclick = () => {
    if (!selectedMyId) return;
    location.href = `/base/character-view.html?id=${selectedMyId}&from=battle`;
};

btnViewEnemy.onclick = () => {
    if (!enemyChar?.id) return;
    location.href = `/base/character-view.html?id=${enemyChar.id}&from=battle`;
};

// ✅ 전투 시작 (battleId 기준 최종 차단)
btnStartBattle.onclick = async () => {
    if (!enemyChar || !enemyChar.id) {
        alert("아직 매칭되지 않았습니다.");
        return;
    }

    let battleId = sessionStorage.getItem("battleId");

    if (!battleId) {
        await new Promise(r => setTimeout(r, 1500));
        battleId = sessionStorage.getItem("battleId");
    }

    if (!battleId) {
        alert("전투 생성이 아직 완료되지 않았습니다.");
        return;
    }

    location.href = "/nbattle/battle-load.html";
};

// ==============================
// ✅ 최초 진입
// ==============================
window._fb.onAuthStateChanged(window._fb.auth, async (user) => {
    if (!user) {
        alert("로그인이 필요합니다.");
        location.href = "/base/index.html";
        return;
    }

    const token = await window._fb.auth.currentUser.getIdToken();

    // ✅ 1️⃣ 내 캐릭터 목록 먼저 불러오기
    await loadBattlePrepare();
    // → 여기서 myCharacters[], selectedMyId, enemyChar 설정됨

    // 캐릭터가 아예 없으면 막기
    if (!selectedMyId) {
        alert("캐릭터가 없습니다.");
        return;
    }

    // ✅ 2️⃣ 진행 중 battle 복원 시도 (myId 포함)
    const restoreRes = await fetch(API, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json"
        },
        credentials: "include",

        body: JSON.stringify({
            action: "restore",
            myId: selectedMyId       // ⬅ 핵심 수정
        })
    });

    const restoreData = await restoreRes.json();

    // ✅ 3️⃣ 진행 중 battle 있으면 → battleId 복구 & UI 그대로
    if (restoreData.battleId) {
        sessionStorage.setItem("battleId", restoreData.battleId);

        // 서버가 enemy 정보를 내려준 경우
        if (restoreData.enemy) {
            enemyChar = restoreData.enemy;
        }

        updateEnemyPreview();

        // 버튼 눌러야 battle-load로 이동
        return;
    }

    // ✅ 4️⃣ 새 battle 생성 로직 실행
    enemyChar = null;
    updateEnemyPreview();

    await requestMatchOrCreate();   // match + battle 생성 통합 함수
});


