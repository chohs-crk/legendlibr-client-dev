// base/battle/battle.js

import { checkBattleMatch } from "./match-client.js";
import { apiFetch } from "/base/api.js";

/* =========================
   UI: 아코디언 토글
========================= */
function toggleAccordion() {
    const body = document.getElementById("battleCharList");
    if (!body) return;
    body.style.display = body.style.display === "none" ? "block" : "none";
}

/* =========================
   공통: 매칭 캐시 제거
========================= */
function clearBattleMatchCache(charId) {
    if (!charId) return;
    sessionStorage.removeItem(`battleMatchCache:${charId}`);
}

/* =========================
   UI 초기화 함수
========================= */
function resetBattleUI() {
    const statusEl = document.getElementById("battleStatus");
    const startBtn = document.getElementById("btnBattleStart");
    const debugEl = document.getElementById("battleDebug");

    if (statusEl) statusEl.textContent = "상대를 탐색 중입니다...";
    if (startBtn) {
        startBtn.style.display = "none";
        startBtn.disabled = false;
        startBtn.textContent = "⚔ 배틀 시작";
        // 혹시 이전 onclick이 남아있을 수 있어 초기화
        startBtn.onclick = null;
    }
    if (debugEl) debugEl.textContent = "";
}

/* =========================
   UI: 캐릭터 리스트 렌더
   - 이름만 표시
========================= */
function renderBattleCharList(chars) {
    const listEl = document.getElementById("battleCharList");
    const toggleBtn = document.getElementById("battleCharToggle");

    if (!listEl || !toggleBtn) return;

    listEl.innerHTML = "";

    chars.forEach((c) => {
        const btn = document.createElement("button");
        btn.className = "battle-char-item";
        btn.textContent = c.displayRawName || "(이름 없음)";

        btn.onclick = async () => {
            // 선택 캐릭터 변경
            sessionStorage.setItem("battleCharId", c.id);

            // UI 반영
            toggleBtn.textContent = `선택: ${btn.textContent}`;
            listEl.style.display = "none";

            // 🔥 캐릭터 변경 후 재매칭
            await initBattlePage(true);
        };

        listEl.appendChild(btn);
    });
}

/* =========================
   캐릭터 목록 확보
   (home 캐시 → 서버)
========================= */
async function getMyCharactersSafe() {
    // 1️⃣ home 캐시
    const cached = sessionStorage.getItem("homeCharacters");
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        } catch {
            sessionStorage.removeItem("homeCharacters");
        }
    }

    // 2️⃣ 서버 fallback
    const res = await apiFetch("/base/characters");
    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data.characters) ? data.characters : [];
}

/* =========================
   메인 진입
========================= */
export async function initBattlePage(isRetry = false) {
    resetBattleUI();

    const statusEl = document.getElementById("battleStatus");
    const debugEl = document.getElementById("battleDebug");
    if (!statusEl) return;

    try {
        /* =========================
           1️⃣ 캐릭터 목록 확보
        ========================= */
        const chars = await getMyCharactersSafe();

        if (!chars.length) {
            statusEl.textContent = "전투할 캐릭터가 없습니다.";
            return;
        }

        /* =========================
           2️⃣ battleCharId 보정
        ========================= */
        let battleCharId = sessionStorage.getItem("battleCharId");
        const exists = chars.some((c) => c.id === battleCharId);

        if (!battleCharId || !exists) {
            battleCharId = chars[0].id;
            sessionStorage.setItem("battleCharId", battleCharId);
        }

        /* =========================
           3️⃣ 캐릭터 선택 UI 세팅
        ========================= */
        renderBattleCharList(chars);

        const selected = chars.find((c) => c.id === battleCharId);
        const toggleBtn = document.getElementById("battleCharToggle");

        if (toggleBtn && selected) {
            toggleBtn.textContent = `선택: ${selected.displayRawName || "(이름 없음)"}`;
            toggleBtn.onclick = toggleAccordion;
        }

        /* =========================
           4️⃣ 매칭 호출
        ========================= */
        statusEl.textContent = "상대를 탐색 중입니다...";
        const result = await checkBattleMatch();

        if (!result.matched) {
            statusEl.textContent = "매칭 가능한 상대가 없습니다.";
            return;
        }

        statusEl.textContent = "매칭 완료";

        const startBtn = document.getElementById("btnBattleStart");
        if (startBtn) {
            startBtn.style.display = "block";

            startBtn.onclick = async () => {
                startBtn.disabled = true;
                startBtn.textContent = "전투 준비 중...";

                // ✅ 여기서 한 번만 읽고 끝까지 재사용 (중복 선언 금지)
                const myBattleCharId = sessionStorage.getItem("battleCharId");

                try {
                    // ✅ 실제 API 파일 구조와 맞춤: api/battle/start.js → /api/battle/start
                    const res = await apiFetch("/battle/start", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ myCharId: myBattleCharId }),
                    });

                    let data = {};
                    try {
                        data = await res.json();
                    } catch {
                        data = { error: "INVALID_JSON" };
                    }

                    if (!res.ok) {
                        startBtn.disabled = false;

                        if (data.error === "ENEMY_DELETED") {
                            // ✅ 삭제된 상대면 캐시 제거 후 재매칭
                            clearBattleMatchCache(myBattleCharId);

                            startBtn.textContent = "상대가 사라졌습니다. 재매칭 중...";

                            setTimeout(async () => {
                                await initBattlePage(true);
                            }, 800);

                            return;
                        }

                        startBtn.textContent = `실패 (${res.status}): ${data.error || "UNKNOWN_ERROR"}`;
                        return;
                    }

                    // ✅ 배틀 시작 성공 시 매칭 캐시 제거
                    clearBattleMatchCache(myBattleCharId);

                    startBtn.textContent = `전투 대기열 등록됨 (${data.battleId})`;
                } catch (err) {
                    console.error("🔥 START API ERROR:", err);

                    startBtn.disabled = false;
                    startBtn.textContent = "네트워크 오류. 콘솔 확인";
                    return;
                }
            };
        }

        if (debugEl) {
            debugEl.textContent = JSON.stringify(result, null, 2);
        }
    } catch (e) {
        console.error("[battle]", e);

        /* =========================
           삭제 / 불일치 복구
        ========================= */
        if (!isRetry) {
            sessionStorage.removeItem("battleCharId");
            statusEl.textContent = "캐릭터를 다시 선택합니다...";
            await initBattlePage(true);
            return;
        }

        statusEl.textContent = "매칭 실패";
    }
}