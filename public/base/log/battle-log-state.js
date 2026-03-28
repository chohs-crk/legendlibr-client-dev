const lastBattleStatus = {};

function markEloAnimated(battleId) {
    sessionStorage.setItem(`eloAnimated_${battleId}`, "1");
}

function isEloAnimated(battleId) {
    return sessionStorage.getItem(`eloAnimated_${battleId}`) === "1";
}

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

    const idx = arr.findIndex((item) => item?.id === charId);
    if (idx === -1) return;

    const oldScore = Number(arr[idx].battleScore) || 0;
    arr[idx].battleScore = oldScore + delta;

    sessionStorage.setItem("homeCharacters", JSON.stringify(arr));
}

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

        el.textContent = formatDeltaText(value);

        if (progress < 1) {
            requestAnimationFrame(tick);
        }
    }

    requestAnimationFrame(tick);
}

export function formatDeltaText(value) {
    if (!Number.isFinite(value)) return "";
    return value > 0 ? `+${value}` : `${value}`;
}

export function getDeltaClass(value) {
    if (!Number.isFinite(value)) return "";
    if (value > 0) return "elo-plus";
    if (value < 0) return "elo-minus";
    return "elo-zero";
}

export function syncBattleEloDisplay(container, battle) {
    if (!container || !battle?.id) return;

    const prevStatus = lastBattleStatus[battle.id] ?? null;
    const myDelta = Number.isFinite(battle.myEloDelta) ? battle.myEloDelta : null;
    const enemyDelta = Number.isFinite(battle.enemyEloDelta) ? battle.enemyEloDelta : null;

    if (prevStatus !== "done" && battle.status === "done") {
        applyEloToCharacterCache(battle.myId, myDelta);
        applyEloToCharacterCache(battle.enemyId, enemyDelta);
    }

    lastBattleStatus[battle.id] = battle.status;

    const deltaEls = container.querySelectorAll(".card-elo");
    if (!deltaEls.length) return;

    if (!isEloAnimated(battle.id)) {
        deltaEls.forEach((el) => {
            const value = Number(el.dataset.delta);
            if (Number.isFinite(value)) {
                animateCountUp(el, value, 300);
            }
        });
        markEloAnimated(battle.id);
        return;
    }

    deltaEls.forEach((el) => {
        const value = Number(el.dataset.delta);
        if (Number.isFinite(value)) {
            el.textContent = formatDeltaText(value);
        }
    });
}

export function getCachedBattle(id) {
    const raw = sessionStorage.getItem("battleCacheMap");
    if (!raw) return null;

    try {
        const map = JSON.parse(raw);
        return map[id] || null;
    } catch {
        return null;
    }
}

export function cacheBattle(battle) {
    if (!battle?.id) return;

    const raw = sessionStorage.getItem("battleCacheMap");
    const map = raw ? JSON.parse(raw) : {};
    map[battle.id] = battle;
    sessionStorage.setItem("battleCacheMap", JSON.stringify(map));
}

export function getCachedBattleFromList(battleId) {
    const raw = sessionStorage.getItem("battleListCache");
    if (!raw) return null;

    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return null;
        return list.find((item) => item?.id === battleId) || null;
    } catch {
        return null;
    }
}

export function syncBattleListCache(battleId, patch) {
    const raw = sessionStorage.getItem("battleListCache");
    if (!raw) return;

    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return;

        const idx = list.findIndex((item) => item?.id === battleId);
        if (idx === -1) return;

        list[idx] = {
            ...list[idx],
            ...patch,
        };

        sessionStorage.setItem("battleListCache", JSON.stringify(list));
    } catch {
        return;
    }
}

export function hydrateCachedBattleWithList(battleId, cachedBattle, listCached) {
    if (!cachedBattle && !listCached) return null;

    if (!cachedBattle && listCached) {
        return {
            ...listCached,
            id: battleId,
            logs: Array.isArray(listCached.logs) ? listCached.logs : [],
        };
    }

    if (!cachedBattle) return null;
    if (!listCached) return cachedBattle;

    return {
        ...cachedBattle,
        ...(listCached.image === "called" || listCached.imageCalled === true
            ? {
                  image: "called",
                  imageCalled: true,
              }
            : {}),
        ...(listCached.battleImage
            ? {
                  battleImage: {
                      ...(cachedBattle.battleImage || {}),
                      ...listCached.battleImage,
                  },
              }
            : {}),
    };
}

export function hydrateBattleWithListImageState(battle, listCached) {
    if (!battle || !listCached) return battle;

    if (listCached.image === "called" || listCached.imageCalled === true) {
        return {
            ...battle,
            image: "called",
            imageCalled: true,
            battleImage: {
                ...(battle.battleImage || {}),
                ...(listCached.battleImage || {}),
            },
        };
    }

    return battle;
}
