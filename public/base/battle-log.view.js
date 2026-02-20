import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";
//✅
/* =========================================================
   캐시
========================================================= */

function getCachedBattle(id) {
    const raw = sessionStorage.getItem("battleCacheMap");
    if (!raw) return null;
    try {
        const map = JSON.parse(raw);
        return map[id] || null;
    } catch {
        return null;
    }
}

function cacheBattle(battle) {
    const raw = sessionStorage.getItem("battleCacheMap");
    const map = raw ? JSON.parse(raw) : {};
    map[battle.id] = battle;
    sessionStorage.setItem("battleCacheMap", JSON.stringify(map));
}

/* =========================================================
   API
========================================================= */

async function fetchBattle(id, onlyLogs = false) {
    const url = onlyLogs
        ? `/base/battle-solo?id=${encodeURIComponent(id)}&onlyLogs=1`
        : `/base/battle-solo?id=${encodeURIComponent(id)}`;

    const res = await apiFetch(url);
    if (!res.ok) return null;
    return await res.json();
}

/* =========================================================
   폴링 상태 머신
========================================================= */

let pollCtx = null;

function stopPolling() {
    if (!pollCtx) return;
    clearTimeout(pollCtx.timer);
    clearTimeout(pollCtx.finalTimer);
    pollCtx = null;
}

function startPolling(battleId) {

    stopPolling();

    pollCtx = {
        battleId,
        timer: null,
        finalTimer: null,
        startedAt: Date.now(),
        streamErrorScheduled: false
    };

    tick();
}

async function tick() {

    if (!pollCtx) return;

    const { battleId } = pollCtx;

    const res = await fetchBattle(battleId, false);
    if (!res) return;

    const cached = getCachedBattle(battleId) || {};
    const merged = { ...cached, ...res, id: battleId };

    cacheBattle(merged);
    renderBattle(merged);

    const status = merged.status;

    /* ============================
       종료 조건
    ============================ */

    if (status === "done") {
        stopPolling();
        return;
    }

    if (status === "error") {
        stopPolling();
        renderError(merged);
        return;
    }

    if (status === "stream_error") {

        if (!pollCtx.streamErrorScheduled) {

            pollCtx.streamErrorScheduled = true;

            const waitMs = typeof res.retryAfterMs === "number"
                ? res.retryAfterMs
                : 5500;

            pollCtx.finalTimer = setTimeout(async () => {

                const final = await fetchBattle(battleId, false);
                if (final) {
                    const finalMerged = {
                        ...(getCachedBattle(battleId) || {}),
                        ...final,
                        id: battleId
                    };
                    cacheBattle(finalMerged);
                    renderBattle(finalMerged);
                }

                stopPolling();

            }, waitMs);
        }

        return;
    }

    /* ============================
       오래된 queued 보호
    ============================ */

    if (
        (status === "queued" || status === "processing") &&
        Date.now() - pollCtx.startedAt > 180000
    ) {
        stopPolling();
        renderStale(merged);
        return;
    }

    /* ============================
       다음 폴링
    ============================ */

    const delay = status === "streaming" ? 2000 : 3000;

    pollCtx.timer = setTimeout(tick, delay);
}

/* =========================================================
   렌더
========================================================= */

function renderError(battle) {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="battle-empty">
            전투 처리 중 문제가 발생했습니다.
        </div>
    `;
}

function renderStale(battle) {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="battle-empty">
            전투가 오래 대기 중입니다. 잠시 후 다시 확인해주세요.
        </div>
    `;
}

function renderBattle(battle) {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    const myDelta = battle.myEloDelta;
    const enemyDelta = battle.enemyEloDelta;

    function deltaText(v) {
        if (!Number.isFinite(v)) return "";
        return v > 0 ? `+${v}` : `${v}`;
    }

    function deltaClass(v) {
        if (!Number.isFinite(v)) return "";
        if (v > 0) return "elo-plus";
        if (v < 0) return "elo-minus";
        return "elo-zero";
    }

    const logs = battle.logs || [];
    const fullText = logs.map(l => l.text || "").join("");

    container.innerHTML = `
    <div class="battle-vs-wrapper">

      <div class="battle-card" data-id="${battle.myId}">
        <div class="card-image">
          <img src="${resolveCharImage(battle.myImage)}" />
        </div>
        <div class="card-name">${battle.myName}</div>
        <div class="card-elo ${deltaClass(myDelta)}">
          ${deltaText(myDelta)}
        </div>
      </div>

      <div class="battle-vs-text">VS</div>

      <div class="battle-card" data-id="${battle.enemyId}">
        <div class="card-image">
          <img src="${resolveCharImage(battle.enemyImage)}" />
        </div>
        <div class="card-name">${battle.enemyName}</div>
        <div class="card-elo ${deltaClass(enemyDelta)}">
          ${deltaText(enemyDelta)}
        </div>
      </div>

    </div>

    <div class="battle-log-body text-flow">
      ${fullText || "<div class='battle-empty'>로그 없음</div>"}
    </div>
  `;

    // 🔥 클릭 시 캐릭터 프로필 이동
    document.querySelectorAll(".battle-card").forEach(card => {
        card.addEventListener("click", () => {
            const id = card.dataset.id;
            if (!id) return;
            showPage("character-view", {
                type: "push",
                id
            });
        });
    });
}


/* =========================================================
   초기화
========================================================= */

export async function initBattleLogPage(battleId) {

    if (!battleId) {
        battleId = sessionStorage.getItem("viewBattleId");
    }

    if (!battleId) return;

    const cached = getCachedBattle(battleId);

    /* ============================
       캐시가 error면 서버 호출 안 함
    ============================ */

    if (cached?.status === "error") {
        renderError(cached);
        return;
    }

    /* ============================
       캐시가 done이면 logs만 조회
    ============================ */

    if (cached?.status === "done") {

        renderBattle(cached);

        const logsOnly = await fetchBattle(battleId, true);
        if (logsOnly?.logs) {
            cached.logs = logsOnly.logs;
            cacheBattle(cached);
            renderBattle(cached);
        }

        return;
    }

    /* ============================
       캐시 없으면 최초 조회
    ============================ */

    let battle = cached;

    if (!battle) {

        battle = await fetchBattle(battleId, false);
        if (!battle) return;

        cacheBattle(battle);
    }

    renderBattle(battle);

    if (battle.status !== "done" && battle.status !== "error") {
        startPolling(battleId);
    }
}
