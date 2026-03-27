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

let lastBattleStatus = {};
let battleImagePollCtx = null;

function applyEloToCharacterCache(charId, delta) {
    if (!charId || !Number.isFinite(delta)) return;

    const raw = sessionStorage.getItem("homeCharacters");
    if (!raw) return;

    let arr;

    try {
        arr = JSON.parse(raw);
    } catch {
        return;
    }

    const idx = arr.findIndex(c => c.id === charId);
    if (idx === -1) return;

    const oldScore = Number(arr[idx].battleScore) || 0;
    arr[idx].battleScore = oldScore + delta;

    sessionStorage.setItem("homeCharacters", JSON.stringify(arr));
}

function createInlineDotLoader() {
    const span = document.createElement("span");
    span.className = "inline-dot-loader";
    span.textContent = " .";

    let dotCount = 1;

    const interval = setInterval(() => {
        dotCount = dotCount >= 3 ? 1 : dotCount + 1;
        span.textContent = " " + ".".repeat(dotCount);
    }, 500);

    span.__dotInterval = interval;
    return span;
}

function getBattleImageState(battle) {
    const battleImage = battle?.battleImage || null;
    const hasCalled = battle?.image === "called" || battle?.imageCalled === true;

    if (battleImage?.status === "done" && battleImage?.url) {
        return "done";
    }

    if (battleImage?.status === "error") {
        return "error";
    }

    if (battleImage?.status === "processing") {
        return "processing";
    }

    if (battleImage?.status === "queued") {
        return "queued";
    }

    if (hasCalled) {
        return "called";
    }

    return "idle";
}

function getBattleImageButtonText(imageState, isSubmitting = false) {
    if (isSubmitting) return "생성 요청 중...";
    if (imageState === "queued") return "생성 대기 중";
    if (imageState === "processing") return "생성 중...";
    if (imageState === "done") return "생성 완료";
    if (imageState === "error") return "생성 실패";
    if (imageState === "called") return "요청 접수됨";
    return "배틀 이미지 생성";
}

function getBattleImageStatusText(battle) {
    const imageState = getBattleImageState(battle);
    const errorMessage = battle?.battleImage?.error?.message || battle?.battleImage?.error?.code || "";

    if (imageState === "queued") {
        return "배틀 이미지 생성 대기 중입니다.";
    }

    if (imageState === "processing" || imageState === "called") {
        return "배틀 이미지를 생성하고 있습니다.";
    }

    if (imageState === "done") {
        return "배틀 이미지 생성이 완료되었습니다.";
    }

    if (imageState === "error") {
        return errorMessage || "배틀 이미지 생성에 실패했습니다.";
    }

    return "배틀 로그를 바탕으로 전투 이미지를 생성합니다.";
}

function shouldDisableBattleImageButton(imageState) {
    return imageState !== "idle";
}

function shouldPollBattleImage(battle) {
    if (!battle || battle.status !== "done") return false;
    const imageState = getBattleImageState(battle);
    return imageState === "called" || imageState === "queued" || imageState === "processing";
}

async function requestBattleImageQueue(battleId) {
    const res = await apiFetch("/base/battle-image-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ battleId })
    });

    let json = null;
    try {
        json = await res.json();
    } catch {
        json = null;
    }

    if (!res.ok || json?.ok === false) {
        throw new Error(
            json?.message ||
            json?.error ||
            "배틀 이미지 요청에 실패했습니다."
        );
    }

    return json;
}

async function requestBattleImageStatus({ battleId, jobId }) {
    const query = new URLSearchParams();

    if (battleId) query.set("battleId", battleId);
    if (jobId) query.set("jobId", jobId);

    const res = await apiFetch(`/base/battle-image-status?${query.toString()}`);

    let json = null;
    try {
        json = await res.json();
    } catch {
        json = null;
    }

    if (!res.ok || json?.ok === false) {
        throw new Error(
            json?.message ||
            json?.error ||
            "배틀 이미지 상태 조회에 실패했습니다."
        );
    }

    return json;
}

function stopBattleImagePolling() {
    if (!battleImagePollCtx) return;
    clearTimeout(battleImagePollCtx.timer);
    battleImagePollCtx = null;
}

function startBattleImagePolling(battle) {
    if (!battle?.id) return;

    const battleId = battle.id;
    const jobId =
        battle?.battleImage?.latestJobId ||
        battle?.imageJobId ||
        null;

    if (
        battleImagePollCtx &&
        battleImagePollCtx.battleId === battleId &&
        battleImagePollCtx.jobId === jobId
    ) {
        return;
    }

    stopBattleImagePolling();

    battleImagePollCtx = {
        battleId,
        jobId,
        timer: null
    };

    tickBattleImagePolling();
}

async function tickBattleImagePolling() {
    if (!battleImagePollCtx) return;

    const { battleId, jobId } = battleImagePollCtx;

    try {
        const statusRes = await requestBattleImageStatus({ battleId, jobId });
        const cached = getCachedBattle(battleId) || { id: battleId };
        const merged = mergeBattleImageStatusIntoBattle(cached, statusRes);

        cacheBattle(merged);
        syncBattleListCache(battleId, {
            image: merged.image,
            imageCalled: merged.imageCalled === true,
            imageJobId: merged.imageJobId || null,
            battleImage: merged.battleImage || null
        });

        renderBattle(merged);

        if (!shouldPollBattleImage(merged)) {
            stopBattleImagePolling();
            return;
        }
    } catch (err) {
        console.error("BATTLE_IMAGE_POLL_FAILED:", err);
    }

    if (!battleImagePollCtx) return;
    battleImagePollCtx.timer = setTimeout(tickBattleImagePolling, 3000);
}

function mergeBattleImageStatusIntoBattle(battle, statusRes) {
    const next = {
        ...(battle || {})
    };

    if (!next.id && statusRes?.battleId) {
        next.id = statusRes.battleId;
    }

    next.image = "called";
    next.imageCalled = true;

    if (statusRes?.id) {
        next.imageJobId = statusRes.id;
    }

    next.battleImage = {
        ...(battle?.battleImage || {}),
        ...(statusRes?.battleImage || {}),
        latestJobId:
            statusRes?.battleImage?.latestJobId ||
            statusRes?.id ||
            battle?.battleImage?.latestJobId ||
            battle?.imageJobId ||
            null,
        status:
            statusRes?.battleImage?.status ||
            statusRes?.status ||
            battle?.battleImage?.status ||
            "called",
        url:
            statusRes?.battleImage?.url ||
            statusRes?.imageUrl ||
            battle?.battleImage?.url ||
            null,
        error:
            statusRes?.battleImage?.error ||
            statusRes?.error ||
            battle?.battleImage?.error ||
            null,
        updatedAt:
            statusRes?.battleImage?.updatedAt ||
            battle?.battleImage?.updatedAt ||
            Date.now()
    };

    return next;
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
    if (!battle?.id) return;

    const raw = sessionStorage.getItem("battleCacheMap");
    const map = raw ? JSON.parse(raw) : {};
    map[battle.id] = battle;
    sessionStorage.setItem("battleCacheMap", JSON.stringify(map));
}

function getCachedBattleFromList(battleId) {
    const raw = sessionStorage.getItem("battleListCache");
    if (!raw) return null;

    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return null;
        return list.find(item => item?.id === battleId) || null;
    } catch {
        return null;
    }
}

function syncBattleListCache(battleId, patch) {
    const raw = sessionStorage.getItem("battleListCache");
    if (!raw) return;

    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return;

        const idx = list.findIndex(item => item?.id === battleId);
        if (idx === -1) return;

        list[idx] = {
            ...list[idx],
            ...patch
        };

        sessionStorage.setItem("battleListCache", JSON.stringify(list));
    } catch {
        return;
    }
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

    if (status === "done") {
        stopPolling();

        if (shouldPollBattleImage(merged)) {
            startBattleImagePolling(merged);
        }

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

                    if (shouldPollBattleImage(finalMerged)) {
                        startBattleImagePolling(finalMerged);
                    }
                }

                stopPolling();
            }, waitMs);
        }

        return;
    }

    if (
        (status === "queued" || status === "processing") &&
        Date.now() - pollCtx.startedAt > 180000
    ) {
        stopPolling();
        renderStale(merged);
        return;
    }

    const delay = status === "streaming" ? 2000 : 3000;
    pollCtx.timer = setTimeout(tick, delay);
}

/* =========================================================
   렌더
========================================================= */

function renderError() {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="battle-empty">
            전투 처리 중 문제가 발생했습니다.
        </div>
    `;
}

function renderStale() {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="battle-empty">
            전투가 오래 대기 중입니다. 잠시 후 다시 확인해주세요.
        </div>
    `;
}

function renderBattle(battle) {
    document.querySelectorAll(".inline-dot-loader").forEach(el => {
        if (el.__dotInterval) {
            clearInterval(el.__dotInterval);
        }
    });

    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    if (!battle || typeof battle !== "object") {
        container.innerHTML = "<div class='battle-empty'>데이터 없음</div>";
        return;
    }

    const isMyWin = battle.winnerId === battle.myId;
    const isEnemyWin = battle.winnerId === battle.enemyId;

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

    const prevStatus = lastBattleStatus[battle.id] ?? null;

    if (prevStatus !== "done" && battle.status === "done") {
        applyEloToCharacterCache(battle.myId, myDelta);
        applyEloToCharacterCache(battle.enemyId, enemyDelta);
    }

    lastBattleStatus[battle.id] = battle.status;

    function deltaClass(v) {
        if (!Number.isFinite(v)) return "";
        if (v > 0) return "elo-plus";
        if (v < 0) return "elo-minus";
        return "elo-zero";
    }

    const logs = Array.isArray(battle.logs) ? battle.logs : [];
    const imageState = getBattleImageState(battle);
    const isRunning =
        battle.status !== "done" &&
        battle.status !== "error";

    let rawText = logs.map(l => l?.text || "").join("\n");

    if (!logs.length && isRunning) {
        rawText = "전투 진행 중";
    }

    const formattedRaw = formatStoryWithDialogue(rawText);
    const fullText = parseStoryText(formattedRaw);
    const battleImageUrl = battle?.battleImage?.url || "";
    const battleImageStatusText = getBattleImageStatusText(battle);

    container.innerHTML = `
    <div class="battle-vs-wrapper">
      <div class="battle-card ${isMyWin ? "winner" : "loser"}" data-id="${myId || ""}">
        <div class="card-image">
          <img src="${resolveCharImage(myImage)}" />
        </div>
        <div class="card-name">${myName}</div>
       ${Number.isFinite(myDelta) ? `
          <div class="card-elo ${deltaClass(myDelta)}" data-delta="${myDelta}"></div>
       ` : ``}
      </div>

      <div class="battle-vs-text">VS</div>

      <div class="battle-card ${isEnemyWin ? "winner" : "loser"}" data-id="${enemyId || ""}">
        <div class="card-image">
          <img src="${resolveCharImage(enemyImage)}" />
        </div>
        <div class="card-name">${enemyName}</div>
        ${Number.isFinite(enemyDelta) ? `
          <div class="card-elo ${deltaClass(enemyDelta)}" data-delta="${enemyDelta}"></div>
        ` : ``}
      </div>
    </div>

    ${battle.status === "done" ? `
      <div class="battle-image-action-wrap">
        <button
          type="button"
          id="battleImageCreateBtn"
          class="battle-image-create-btn"
          ${shouldDisableBattleImageButton(imageState) ? "disabled" : ""}
        >
          ${getBattleImageButtonText(imageState, false)}
        </button>
        <div class="battle-image-action-status">
          ${battleImageStatusText}
        </div>
        ${battleImageUrl ? `
          <div class="battle-image-preview" style="margin-top:12px;">
            <img
              src="${battleImageUrl}"
              alt="battle image"
              style="width:100%; border-radius:12px; display:block;"
            />
          </div>
        ` : ``}
      </div>
    ` : ""}

    <div class="battle-log-body text-flow">
      ${fullText || "<div class='battle-empty'>로그 없음</div>"}
    </div>
  `;

    const logBody = container.querySelector(".battle-log-body");
    if (!logBody) return;

    if (isRunning) {
        const loader = createInlineDotLoader();
        logBody.appendChild(loader);
    }

    if (!isEloAnimated(battle.id)) {
        document.querySelectorAll(".card-elo").forEach(el => {
            const v = Number(el.dataset.delta);
            if (Number.isFinite(v)) {
                animateCountUp(el, v, 300);
            }
        });

        markEloAnimated(battle.id);
    } else {
        document.querySelectorAll(".card-elo").forEach(el => {
            const v = Number(el.dataset.delta);
            if (Number.isFinite(v)) {
                el.textContent = v > 0 ? `+${v}` : `${v}`;
            }
        });
    }

    const battleImageCreateBtn = container.querySelector("#battleImageCreateBtn");

    if (battleImageCreateBtn) {
        battleImageCreateBtn.addEventListener("click", async () => {
            if (battleImageCreateBtn.disabled) return;

            const prevBattle = { ...battle };
            const pendingBattle = {
                ...battle,
                image: "called",
                imageCalled: true,
                battleImage: {
                    ...(battle?.battleImage || {}),
                    latestJobId: battle?.battleImage?.latestJobId || battle?.imageJobId || null,
                    status: "queued",
                    url: battle?.battleImage?.url || null,
                    error: null,
                    updatedAt: Date.now()
                }
            };

            battleImageCreateBtn.disabled = true;
            battleImageCreateBtn.textContent = getBattleImageButtonText("idle", true);

            cacheBattle(pendingBattle);
            syncBattleListCache(battle.id, {
                image: "called",
                imageCalled: true,
                battleImage: pendingBattle.battleImage
            });

            try {
                const queued = await requestBattleImageQueue(battle.id);

                const merged = mergeBattleImageStatusIntoBattle(pendingBattle, queued);
                cacheBattle(merged);
                syncBattleListCache(battle.id, {
                    image: merged.image,
                    imageCalled: merged.imageCalled === true,
                    imageJobId: merged.imageJobId || null,
                    battleImage: merged.battleImage || null
                });
                renderBattle(merged);
                startBattleImagePolling(merged);
            } catch (err) {
                cacheBattle(prevBattle);
                syncBattleListCache(battle.id, {
                    image: prevBattle.image,
                    imageCalled: prevBattle.imageCalled === true,
                    imageJobId: prevBattle.imageJobId || null,
                    battleImage: prevBattle.battleImage || null
                });

                battleImageCreateBtn.disabled = false;
                battleImageCreateBtn.textContent = getBattleImageButtonText("idle", false);
                alert(err?.message || "배틀 이미지 요청에 실패했습니다.");
            }
        });
    }

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
    stopBattleImagePolling();

    if (!battleId) {
        battleId = sessionStorage.getItem("viewBattleId");
    }

    if (!battleId) return;

    sessionStorage.setItem("viewBattleId", battleId);

    let cached = getCachedBattle(battleId);
    const listCached = getCachedBattleFromList(battleId);

    if (!cached && listCached) {
        cached = {
            ...listCached,
            id: battleId,
            logs: Array.isArray(listCached.logs) ? listCached.logs : []
        };
        cacheBattle(cached);
    } else if (cached && listCached) {
        cached = {
            ...cached,
            ...(listCached.image === "called" || listCached.imageCalled === true
                ? {
                    image: "called",
                    imageCalled: true
                }
                : {}),
            ...(listCached.battleImage
                ? {
                    battleImage: {
                        ...(cached.battleImage || {}),
                        ...listCached.battleImage
                    }
                }
                : {})
        };
        cacheBattle(cached);
    }

    if (cached?.status === "error") {
        renderError(cached);
        return;
    }

    if (cached?.status === "done") {
        renderBattle(cached);

        const logsOnly = await fetchBattle(battleId, true);
        if (logsOnly) {
            cached = {
                ...cached,
                ...logsOnly,
                id: battleId,
                image: cached.image === "called" || cached.imageCalled === true
                    ? "called"
                    : (logsOnly.image || cached.image),
                imageCalled: cached.imageCalled === true || logsOnly.imageCalled === true,
                battleImage: {
                    ...(cached.battleImage || {}),
                    ...(logsOnly.battleImage || {})
                }
            };
            cacheBattle(cached);
            renderBattle(cached);
        }

        if (shouldPollBattleImage(cached)) {
            startBattleImagePolling(cached);
        }

        return;
    }

    let battle = cached;

    if (!battle) {
        battle = await fetchBattle(battleId, false);
        if (!battle) return;

        if (listCached && (listCached.image === "called" || listCached.imageCalled === true)) {
            battle = {
                ...battle,
                image: "called",
                imageCalled: true,
                battleImage: {
                    ...(battle.battleImage || {}),
                    ...(listCached.battleImage || {})
                }
            };
        }

        cacheBattle(battle);
    }

    renderBattle(battle);

    if (battle.status !== "done" && battle.status !== "error") {
        startPolling(battleId);
        return;
    }

    if (shouldPollBattleImage(battle)) {
        startBattleImagePolling(battle);
    }
}
