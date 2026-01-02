// raid-controller.js (프론트 최종본)
// - Firestore 직접 접근 없음
// - 서버(api/raid-controller-back)에만 요청
// - 스킬 선택 + 로그/HP 표시만 담당

const API = "https://ai-proxy2.vercel.app/api/raid/raid-controller-back";

// 전역 상태
const state = {
    raidId: null,
    boss: null,
    party: [],
    logs: [],
    engagementCount: 1,
    uiTurn: 1,
    currentCharIndex: 0,
    battleEnded: false,
    result: null
};

// DOM
const bossNameEl = document.getElementById("bossName");
const raidInfoEl = document.getElementById("raidInfo");
const storyBox = document.getElementById("storyBox");
const choiceContainer = document.getElementById("choiceContainer");
const choiceButtons = Array.from(
    choiceContainer.querySelectorAll(".choice-btn")
);
const btnGiveUp = document.getElementById("btnGiveUp");
const homeButtonContainer = document.getElementById("homeButtonContainer");

// 공용 API 호출 유틸
async function callRaidAPI(body) {
    const res = await fetch(API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    let data;
    try {
        data = await res.json();
    } catch (e) {
        console.error("raid-controller API JSON parse error:", e);
        throw new Error("서버 응답 파싱 실패");
    }

    if (!res.ok || data.ok === false) {
        console.warn("raid-controller API error:", data);
    }

    return data;
}

// 로그 렌더
function renderLogs() {
    if (!storyBox) return;
    storyBox.innerHTML = "";
    (state.logs || []).forEach(line => {
        storyBox.innerHTML += `
            <div class="log-line" style="margin: 6px 0; line-height: 1.5;">
                ${String(line).replace(/\n/g, "<br>")}
            </div>
        `;
    });
    storyBox.scrollTop = storyBox.scrollHeight;
}

// 전투 UI 렌더
function renderBattleUI() {
    if (!state.boss) return;

    // 상단 보스/교전 정보
    if (bossNameEl) {
        const currentChar = state.party[state.currentCharIndex];
        const charName = currentChar
            ? (currentChar.name || currentChar.displayRawName || "내 캐릭터")
            : "내 캐릭터";

        bossNameEl.textContent = `${state.boss.name} vs ${charName}`;
    }

    if (raidInfoEl) {
        raidInfoEl.textContent = `교전 ${state.engagementCount} / ${state.uiTurn}턴`;
    }

    // 전투 종료 시 UI
    if (state.battleEnded) {
        choiceContainer.style.display = "none";
        if (btnGiveUp) btnGiveUp.style.display = "none";

        homeButtonContainer.innerHTML = `
            <button id="btnGoHome" class="btn" style="width:100%; margin-top:12px;">
                홈으로 돌아가기
            </button>
        `;
        const btnGoHome = document.getElementById("btnGoHome");
        if (btnGoHome) {
            btnGoHome.onclick = () => {
                location.href = "/base/index.html";
            };
        }
        return;
    }

    // 전투 진행 중 선택지 렌더
    choiceContainer.style.display = "flex";
    if (btnGiveUp) btnGiveUp.style.display = "block";
    homeButtonContainer.innerHTML = "";

    const ch = state.party[state.currentCharIndex];
    if (!ch || ch.currentHp <= 0) {
        // 서버가 이미 currentCharIndex를 조정해주므로,
        // 여기까지 오면 선택지만 잠깐 비활성화
        choiceButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.display = "none";
        });
        return;
    }

   
    // 선택된 인덱스(0~2) 배열
    let selected = Array.isArray(ch.selectedSkills) ? ch.selectedSkills : [];
    const skills = Array.isArray(ch.skills) ? ch.skills : [];

    // ✅ 디버깅용(콘솔 확인)
    console.log("[RAID] 현재 캐릭터:", ch.name || ch.displayRawName);
    console.log(" - selectedSkills:", selected);
    console.log(" - skills:", skills);

    // selected가 비었으면 그냥 앞에서부터 3개 사용
    if (!selected.length && skills.length) {
        selected = skills.map((_, idx) => idx).slice(0, 3);
    }

    choiceButtons.forEach((btn, i) => {
        const realSkillIndex = selected[i];
        const skill = skills[realSkillIndex];

        if (!skill) {
            btn.style.display = "none";
            btn.disabled = true;
            btn.textContent = "";
            btn.removeAttribute("data-index");
            return;
        }

        btn.style.display = "block";
        btn.disabled = false;
        btn.textContent = `${i + 1}. ${skill.name}`;
        btn.dataset.index = String(i);
    });



}

// 전체 렌더
function renderAll() {
    renderLogs();
    renderBattleUI();
}

// 전투 로드
async function loadRaidBattle() {
    const params = new URLSearchParams(location.search);
    const raidId = params.get("raidId");

    if (!raidId) {
        alert("레이드 ID가 없습니다.");
        location.href = "/raid/raid.html";
        return;
    }

    state.raidId = raidId;

    const data = await callRaidAPI({
        action: "load",
        raidId
    });

    if (!data.ok) {
        alert("레이드를 불러오지 못했습니다.");
        location.href = "/raid/raid.html";
        return;
    }

    state.boss = data.boss;
    state.party = data.party || [];
    state.logs = data.logs || [];
    state.engagementCount = data.engagementCount ?? 1;
    state.uiTurn = data.uiTurn ?? 1;
    state.currentCharIndex = data.currentCharIndex ?? 0;
    state.battleEnded = !!data.battleEnded;
    state.result = data.result || null;

    renderAll();
}

// 선택지 클릭 → 서버에 턴 요청
async function handleChoiceClick(event) {
    if (state.battleEnded) return;

    const btn = event.currentTarget;
    const skillIndex = Number(btn.dataset.index);
    if (Number.isNaN(skillIndex)) return;

    // 선택 중 중복 클릭 방지
    choiceButtons.forEach(b => (b.disabled = true));

    try {
        const data = await callRaidAPI({
            action: "turn",
            raidId: state.raidId,
            skillIndex
        });
        if (data.error === "NO_SESSION") {
            console.warn("⚠️ NO_SESSION → 자동 복구 시도");

            await loadRaidBattle();  // 세션 복구 시도
            return await handleChoiceClick(event); // 재시도
        }

        if (data.error === "BATTLE_SESSION_LOST") {
            alert("⚠️ 전투 중 오류가 발생하여 전투를 다시 시작해야 합니다.");

            // 전투 재시작 화면(레이드 선택 화면)으로 이동
            location.href = "/raid/raid.html";
            return;
        }


        if (!data.ok) {
            alert("턴 처리에 실패했습니다.");
            return;
        }

        state.boss = data.boss;
        state.party = data.party || [];
        state.logs = data.logs || [];
        state.engagementCount = data.engagementCount ?? state.engagementCount;
        state.uiTurn = data.uiTurn ?? state.uiTurn;
        state.currentCharIndex = data.currentCharIndex ?? state.currentCharIndex;
        state.battleEnded = !!data.battleEnded;
        state.result = data.result || state.result;

        renderAll();
    } catch (e) {
        console.error("handleChoiceClick error:", e);
        alert("서버 통신 중 오류가 발생했습니다.");
    } finally {
        if (!state.battleEnded) {
            choiceButtons.forEach(b => (b.disabled = false));
        }
    }
}

// 레이드 포기
async function handleGiveUp() {
    if (!state.raidId) return;

    const confirmGiveUp = confirm("정말 레이드를 포기하시겠습니까?\n패배로 처리됩니다.");
    if (!confirmGiveUp) return;

    try {
        await callRaidAPI({
            action: "giveup",
            raidId: state.raidId
        });
    } catch (e) {
        console.warn("giveup error (무시 가능):", e);
    }

    location.href = "/base/index.html";
}

// 초기 바인딩 & 로그인 체크
(async () => {
    try {
        // 세션 쿠키 기반 로그인 확인
        const res = await fetch("https://ai-proxy2.vercel.app/api/base/auth?action=me", {
            method: "GET",
            credentials: "include"
        });

        if (!res.ok) {
            alert("로그인이 필요합니다.");
            location.href = "/base/index.html";
            return;
        }

        // 버튼 이벤트 바인딩
        choiceButtons.forEach(btn => {
            btn.addEventListener("click", handleChoiceClick);
        });

        if (btnGiveUp) {
            btnGiveUp.onclick = handleGiveUp;
        }

        await loadRaidBattle();
    } catch (e) {
        console.error("raid-controller init error:", e);
        alert("레이드 전투 초기화 중 오류가 발생했습니다.");
        location.href = "/raid/raid.html";
    }
})();
