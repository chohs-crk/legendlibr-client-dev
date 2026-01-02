// battle-load.js

const statusEl = document.getElementById("statusText");
const STATUS_API = "https://ai-proxy2.vercel.app/api/battle/battle-status";

function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

async function waitBattleReadyLongPolling() {
    const battleId = sessionStorage.getItem("battleId");
    const token = sessionStorage.getItem("firebaseToken");

    if (!battleId) {
        setStatus("전투 정보가 없습니다.");
        return;
    }

    setStatus("AI 전투 데이터 생성 중...");

    try {
        const res = await fetch(STATUS_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ battleId })
        });


        const data = await res.json();

        // ✅ AI 준비 완료 → 즉시 이동
        if (data.ready === true) {
            setStatus("전투 준비 완료! 이동 중...");
            location.href = "/nbattle/battle-controller.html";
            return;
        }

        // ✅ 전투가 이미 종료된 경우
        if (data.finished === true) {
            setStatus("이미 종료된 전투입니다.");
            return;
        }

        // ✅ 60초 타임아웃 → 다시 1번 더 요청
        if (data.timeout === true) {
            console.warn("⏱️ LONG POLLING TIMEOUT → 재요청");
            waitBattleReadyLongPolling();
            return;
        }

    } catch (err) {
        console.error("❌ battle-load LONG POLLING ERROR:", err);
        setStatus("서버 연결 오류... 재시도 중");
        setTimeout(waitBattleReadyLongPolling, 2000);
    }
}


// ✅ 페이지 진입 시 딱 1번만 실행
setTimeout(waitBattleReadyLongPolling, 2000);

// 좌상단 홈 버튼 기능
const homeBtn = document.getElementById("btnHome");

if (homeBtn) {
    homeBtn.addEventListener("click", () => {
        console.log("🏠 홈 버튼 클릭됨 — battle-load 탈출");
        // battleId는 그대로 유지 → 나중에 다시와도 이어짐
        location.href = "/base/index.html";
    });
}
