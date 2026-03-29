import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";
import {
    cacheBattle,
    getCachedBattle,
    getCachedBattleFromList,
    getDeltaClass,
    hydrateBattleWithListImageState,
    hydrateCachedBattleWithList,
    syncBattleEloDisplay,
    syncBattleListCache,
} from "./log/battle-log-state.js";
import {
    attachBattleLogSection,
    buildBattleLogSection,
} from "./log/battle-log-section.js";
import {
    buildBattleImageSection,
    buildErrorBattleImageState,
    buildPendingBattleImageState,
    canRequestBattleImage,
    mergeBattleImageStatusIntoBattle,
    requestBattleImageQueue,
    requestBattleImageStatus,
    shouldPollBattleImage,
} from "./log/battle-image-section.js";

let battleImagePollCtx = null;
let pollCtx = null;

function syncUserMetaCache(userMeta) {
    if (!userMeta || typeof userMeta !== "object") return;
    sessionStorage.setItem("userMeta", JSON.stringify(userMeta));
    window.__updateChromeResource?.(userMeta);
}

async function refreshUserMetaCache() {
    try {
        const res = await apiFetch("/base/user-meta");
        if (!res.ok) return null;

        const userMeta = await res.json();
        syncUserMetaCache(userMeta);
        return userMeta;
    } catch {
        return null;
    }
}

function buildBattleCard({ id, name, image, delta, isWinner }) {
    return `
        <div class="battle-card ${isWinner ? "winner" : "loser"}" data-id="${id || ""}">
            <div class="card-image">
                <img src="${resolveCharImage(image)}" />
            </div>
            <div class="card-name">${name}</div>
            ${Number.isFinite(delta) ? `
                <div class="card-elo ${getDeltaClass(delta)}" data-delta="${delta}"></div>
            ` : ""}
        </div>
    `;
}

function renderMessage(message) {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="battle-empty">
            ${message}
        </div>
    `;
}

function renderLoading() {
    renderMessage("전투 기록을 불러오는 중입니다.");
}

function renderError() {
    renderMessage("전투 처리 중 문제가 발생했습니다.");
}

function renderStale() {
    renderMessage("전투가 오래 대기 중입니다. 잠시 후 다시 확인해주세요.");
}

function bindCharacterCardEvents(container) {
    container.querySelectorAll(".battle-card").forEach((card) => {
        card.addEventListener("click", () => {
            const id = card.dataset.id;
            if (!id || typeof id !== "string") return;

            sessionStorage.setItem("viewCharId", id);

            if (window.showPage) {
                window.showPage("character-view", {
                    type: "push",
                    charId: id,
                });
            }
        });
    });
}

function persistBattleImageState(battle) {
    cacheBattle(battle);
    syncBattleListCache(battle.id, {
        image: battle.image,
        imageCalled: battle.imageCalled === true,
        imageJobId: battle.imageJobId || null,
        battleImage: battle.battleImage || null,
    });
}

async function handleBattleImageRequest(battle) {
    if (!battle?.id || !canRequestBattleImage(battle)) return;

    const pendingBattle = buildPendingBattleImageState(battle);
    persistBattleImageState(pendingBattle);
    renderBattle(pendingBattle);

    try {
        const queued = await requestBattleImageQueue(battle.id);
        syncUserMetaCache(queued?.userMeta);

        const merged = mergeBattleImageStatusIntoBattle(pendingBattle, queued);
        persistBattleImageState(merged);
        renderBattle(merged);
        startBattleImagePolling(merged);
    } catch (error) {
        const errorBattle = buildErrorBattleImageState(battle, error);
        persistBattleImageState(errorBattle);
        renderBattle(errorBattle);
    }
}

function bindBattleImageEvents(container, battle) {
    const trigger = container.querySelector('[data-action="battle-image-request"]');
    if (!trigger) return;

    trigger.addEventListener("click", () => {
        handleBattleImageRequest(battle);
    });
}

function renderBattle(battle) {
    const container = document.getElementById("battleLogContainer");
    if (!container) return;

    if (!battle || typeof battle !== "object") {
        renderMessage("데이터 없음");
        return;
    }

    const isMyWin = battle.winnerId === battle.myId;
    const isEnemyWin = battle.winnerId === battle.enemyId;

    const myDelta = Number.isFinite(battle.myEloDelta) ? battle.myEloDelta : null;
    const enemyDelta = Number.isFinite(battle.enemyEloDelta) ? battle.enemyEloDelta : null;

    container.innerHTML = `
        <div class="battle-vs-wrapper">
            ${buildBattleCard({
                id: battle.myId || null,
                name: battle.myName || "공격자",
                image: battle.myImage || null,
                delta: myDelta,
                isWinner: isMyWin,
            })}

            <div class="battle-vs-text">VS</div>

            ${buildBattleCard({
                id: battle.enemyId || null,
                name: battle.enemyName || "수비자",
                image: battle.enemyImage || null,
                delta: enemyDelta,
                isWinner: isEnemyWin,
            })}
        </div>

        ${buildBattleImageSection(battle)}
        ${buildBattleLogSection(battle)}
    `;

    syncBattleEloDisplay(container, battle);
    attachBattleLogSection(container, battle);
    bindBattleImageEvents(container, battle);
    bindCharacterCardEvents(container);
}

async function fetchBattle(id, onlyLogs = false) {
    const url = onlyLogs
        ? `/base/battle-solo?id=${encodeURIComponent(id)}&onlyLogs=1`
        : `/base/battle-solo?id=${encodeURIComponent(id)}`;

    const res = await apiFetch(url);
    if (!res.ok) return null;
    return await res.json();
}

function stopBattleImagePolling() {
    if (!battleImagePollCtx) return;
    clearTimeout(battleImagePollCtx.timer);
    battleImagePollCtx = null;
}

function startBattleImagePolling(battle) {
    if (!battle?.id) return;

    const battleId = battle.id;
    const jobId = battle?.battleImage?.latestJobId || battle?.imageJobId || null;

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
        timer: null,
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

        if (merged?.battleImage?.status === "done") {
            await refreshUserMetaCache();
        }

        persistBattleImageState(merged);
        renderBattle(merged);

        if (!shouldPollBattleImage(merged)) {
            stopBattleImagePolling();
            return;
        }
    } catch (error) {
        console.error("BATTLE_IMAGE_POLL_FAILED:", error);
    }

    if (!battleImagePollCtx) return;
    battleImagePollCtx.timer = setTimeout(tickBattleImagePolling, 3000);
}

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
        streamErrorScheduled: false,
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

            const waitMs = typeof res.retryAfterMs === "number" ? res.retryAfterMs : 5500;

            pollCtx.finalTimer = setTimeout(async () => {
                const final = await fetchBattle(battleId, false);
                if (final) {
                    const finalMerged = {
                        ...(getCachedBattle(battleId) || {}),
                        ...final,
                        id: battleId,
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

export async function initBattleLogPage(battleId) {
    stopPolling();
    stopBattleImagePolling();
    renderLoading();

    if (!battleId) {
        battleId = sessionStorage.getItem("viewBattleId");
    }

    if (!battleId) return;

    sessionStorage.setItem("viewBattleId", battleId);

    const listCached = getCachedBattleFromList(battleId);
    let cached = hydrateCachedBattleWithList(battleId, getCachedBattle(battleId), listCached);

    if (cached) {
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
                image:
                    cached.image === "called" || cached.imageCalled === true
                        ? "called"
                        : (logsOnly.image || cached.image),
                imageCalled: cached.imageCalled === true || logsOnly.imageCalled === true,
                battleImage: {
                    ...(cached.battleImage || {}),
                    ...(logsOnly.battleImage || {}),
                },
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
        if (!battle) {
            renderError();
            return;
        }

        battle = hydrateBattleWithListImageState(battle, listCached);
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

window.registerPageHooks?.("battle-log", {
    onHide() {
        stopPolling();
        stopBattleImagePolling();
    },
});
