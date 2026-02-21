import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";
import { parseStoryText } from "/base/common/story-parser.js";
import { formatStoryWithDialogue } from "/base/common/story-format.js";

function markEloAnimated(battleId) {
    sessionStorage.setItem(`eloAnimated_${battleId}`, "1");
}

function isEloAnimated(battleId) {
    return sessionStorage.getItem(`eloAnimated_${battleId}`) === "1";
}


//✅
/* =========================================================
   캐시
========================================================= */
function animateCountUp(el, target, duration = 300) {
    if (!Number.isFinite(target)) {
        el.textContent = "";
        return;
    }

    const start = 0;
    const startTime = performance.now();

    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const value = Math.round(start + (target - start) * progress);

        el.textContent = target > 0 ? `+${value}` : `${value}`;

        if (progress < 1) {
            requestAnimationFrame(tick);
        }
    }

    requestAnimationFrame(tick);
}

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

    const isMyWin = battle.winnerId === battle.myId;
    const isEnemyWin = battle.winnerId === battle.enemyId;

    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    // 🔥 battle 자체가 없을 경우 방어
    if (!battle || typeof battle !== "object") {
        container.innerHTML = "<div class='battle-empty'>데이터 없음</div>";
        return;
    }

    const myId = battle.myId || null;
    const enemyId = battle.enemyId || null;

    const myName = battle.myName || "공격자";
    const enemyName = battle.enemyName || "수비자";

    const myImage = battle.myImage || null;
    const enemyImage = battle.enemyImage || null;

    const myDelta = Number.isFinite(battle.myEloDelta)
        ? battle.myEloDelta
        : null;

    const enemyDelta = Number.isFinite(battle.enemyEloDelta)
        ? battle.enemyEloDelta
        : null;

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

    const logs = Array.isArray(battle.logs) ? battle.logs : [];
    const rawText = logs.map(l => l?.text || "").join("\n");

    // 🔥 fullText 변형 전에 포맷 적용
    const formattedRaw = formatStoryWithDialogue(rawText);


    const fullText = parseStoryText(formattedRaw);


    container.innerHTML = `
    <div class="battle-vs-wrapper">

      <div class="battle-card ${isMyWin ? "winner" : "loser"}" data-id="${myId || ""}">
        <div class="card-image">
          <img src="${resolveCharImage(myImage)}" />
        </div>
        <div class="card-name">${myName}</div>
       ${Number.isFinite(myDelta) ? `
  <div class="card-elo ${deltaClass(myDelta)}" data-delta="${myDelta}">
  </div>
` : ``}

      </div>

      <div class="battle-vs-text">VS</div>

     <div class="battle-card ${isEnemyWin ? "winner" : "loser"}" data-id="${enemyId || ""}">
        <div class="card-image">
          <img src="${resolveCharImage(enemyImage)}" />
        </div>
        <div class="card-name">${enemyName}</div>
      ${Number.isFinite(enemyDelta) ? `
  <div class="card-elo ${deltaClass(enemyDelta)}" data-delta="${enemyDelta}">
  </div>
` : ``}
      </div>

    </div>

    <div class="battle-log-body text-flow">
      ${fullText || "<div class='battle-empty'>로그 없음</div>"}
    </div>
  `;
    // 🔥 ELO 카운트업 적용
    if (!isEloAnimated(battle.id)) {

        document.querySelectorAll(".card-elo").forEach(el => {
            const v = Number(el.dataset.delta);
            if (Number.isFinite(v)) {
                animateCountUp(el, v, 300);
            }
        });

        markEloAnimated(battle.id);

    } else {

        // 이미 애니메이션 했으면 바로 최종값 표시
        document.querySelectorAll(".card-elo").forEach(el => {
            const v = Number(el.dataset.delta);
            if (Number.isFinite(v)) {
                el.textContent = v > 0 ? `+${v}` : `${v}`;
            }
        });
    }


    // 🔥 클릭 안전 처리
    document.querySelectorAll(".battle-card").forEach(card => {
        card.addEventListener("click", () => {
            const id = card.dataset.id;
            if (!id || typeof id !== "string") return;

            sessionStorage.setItem("viewCharId", id);

            if (window.showPage) {
                window.showPage("character-view", {
                    type: "push",
                    charId: id
                });
            }
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
//