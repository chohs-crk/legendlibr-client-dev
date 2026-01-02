// ==========================================
// raid-load.js (프론트 - 레이드 로딩 전용)
// 000 → 대기, 100 → 시작, 없으면 000 생성은 서버 담당
// ==========================================


// 🔗 API 엔드포인트
const API = "https://ai-proxy2.vercel.app/api/raid/raid-load-back";

// 🔍 URL 파라미터
const params = new URLSearchParams(location.search);
const raidIdParam = params.get("raidId");
const bossIdParam = params.get("bossId");

// 🧾 UI 요소
const statusText = document.getElementById("statusText") || { textContent: "" };
const subText = document.getElementById("subText") || { textContent: "" };

let currentRaidId = null;
let firstInitDone = false;

// ==========================================
// 1. 진입 시 인증 및 초기 엔터/생성 처리
// ==========================================
(async () => {
    try {
        const res = await fetch("https://ai-proxy2.vercel.app/api/base/auth?action=me", {
            method: "GET",
            credentials: "include"
        });

        if (!res.ok) {
            alert("로그인이 필요합니다.");
            location.href = "/base/index.html";
            return;
        }

        if (!raidIdParam && !bossIdParam) {
            alert("잘못된 접근입니다.");
            location.href = "/raid/index.html";
            return;
        }

        statusText.textContent = "레이드 준비 중...";
        subText.textContent = "잠시만 기다려 주세요.";

        const firstStatus = await enterOrCreateRaid();

        currentRaidId = firstStatus.raidId;
        await handleStatus(firstStatus);
        await checkLoop();

    } catch (e) {
        alert("레이드 준비 중 오류 발생");
        location.href = "/raid/index.html";
    }
})();


// ==========================================
// 2. 서버에 최초로 enterOrCreateRaid 요청
//    - raidId 있으면 해당 문서 사용
//    - bossId만 있으면 000 없으면 새로 만들고 AI 예약
// ==========================================
async function enterOrCreateRaid() {
    const body = {
        action: "enterOrCreateRaid"
    };

    if (raidIdParam) body.raidId = raidIdParam;
    if (bossIdParam) body.bossId = bossIdParam;

    const res = await fetch(API, {
        method: "POST",
        credentials: "include",   // ✅ 여기만 있으면 됨
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    return res.json();
}


// ==========================================
// 3. 상태 폴링 루프
// ==========================================
async function checkLoop() {
    while (true) {
        const st = await checkStatus();
        if (!st || !st.ok) {
            statusText.textContent = "상태 확인 중 오류가 발생했습니다.";
            subText.textContent = "잠시 후 다시 시도해 주세요.";
            return;
        }

        const shouldContinue = await handleStatus(st);
        if (!shouldContinue) return; // 이동/종료
    }
}

// ==========================================
// 4. 상태별 처리 (000/100/기타)
// ==========================================
async function handleStatus(st) {
    const { aiready, battlestart, battlefinished } = st;

    // 000 → AI 준비 중 (대기)
    if (!aiready && !battlestart && !battlefinished) {
        statusText.textContent = "AI 전투 데이터를 준비 중입니다...";
        subText.textContent = "대부분 20~30초 이내에 완료됩니다.";
        await sleep(1500);
        return true; // 계속 폴링
    }

    // 100 → 전투 시작 가능
    if (aiready && !battlestart && !battlefinished) {
        statusText.textContent = "전투 준비 완료!";
        subText.textContent = "레이드 전투로 이동합니다...";

        await requestBattleStart();
        // 레이드 컨트롤러로 이동
        location.href = `/raid/raid-controller.html?raidId=${currentRaidId}`;
        return false;
    }

    // 이미 종료된 레이드
    if (battlefinished) {
        statusText.textContent = "이미 종료된 레이드입니다.";
        subText.textContent = "결과 화면 또는 메인으로 돌아가 주세요.";
        return false;
    }

    // 그 외 애매한 상태 (예: battlestart=true, finished=false)
    if (battlestart && !battlefinished) {
        statusText.textContent = "진행 중인 레이드가 감지되었습니다.";
        subText.textContent = "전투 화면으로 이동합니다.";
        location.href = `/raid/raid-controller.html?raidId=${currentRaidId}`;
        return false;
    }

    statusText.textContent = "알 수 없는 상태입니다.";
    subText.textContent = "메인 화면으로 돌아갑니다.";
    await sleep(1500);
    location.href = "/raid/index.html";
    return false;
}

// ==========================================
// 5. 서버에 상태 조회
// ==========================================
async function checkStatus() {
    if (!currentRaidId) return null;

    const res = await fetch(API, {
        method: "POST",
        credentials: "include",   // ✅ 여기로 이동
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            action: "checkStatus",
            raidId: currentRaidId
        })
    });

    return res.json();
}


// ==========================================
// 6. battlestart = true로 전환 요청
// ==========================================
async function requestBattleStart() {
    await fetch(API, {
        method: "POST",
        credentials: "include",   // ✅ 여기
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            action: "startBattle",
            raidId: currentRaidId
        })
    });
}


// ==========================================
// 유틸
// ==========================================
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
