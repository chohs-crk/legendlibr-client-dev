import { apiFetch } from "/base/api.js";

const BATTLE_IMAGE_MODEL_OPTIONS = {
    together_flux2_dev: {
        tier: "general",
        label: "일반",
        shortStatus: "일반 모드",
        costFrames: 35,
    },
    gemini: {
        tier: "advanced",
        label: "고급",
        shortStatus: "고급 모드",
        costFrames: 105,
    },
};

const DEFAULT_BATTLE_IMAGE_MODEL_KEY = "together_flux2_dev";
const BATTLE_IMAGE_SELECTION_STORAGE_KEY = "battleImageModelSelection";

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function readSelectionMap() {
    try {
        const raw = sessionStorage.getItem(BATTLE_IMAGE_SELECTION_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeSelectionMap(map) {
    try {
        sessionStorage.setItem(BATTLE_IMAGE_SELECTION_STORAGE_KEY, JSON.stringify(map || {}));
    } catch {
        // noop
    }
}

export function getBattleImageModelOption(modelKey) {
    return BATTLE_IMAGE_MODEL_OPTIONS[modelKey] || BATTLE_IMAGE_MODEL_OPTIONS[DEFAULT_BATTLE_IMAGE_MODEL_KEY];
}

export function getSelectedBattleImageModelKey(battle) {
    const status = getBattleImageState(battle);
    const lockedModelKey = battle?.battleImage?.modelKey || battle?.modelKey || null;

    if (lockedModelKey && status !== "idle" && status !== "error") {
        return BATTLE_IMAGE_MODEL_OPTIONS[lockedModelKey] ? lockedModelKey : DEFAULT_BATTLE_IMAGE_MODEL_KEY;
    }

    const battleId = battle?.id;
    if (battleId) {
        const map = readSelectionMap();
        const stored = map?.[battleId];
        if (stored && BATTLE_IMAGE_MODEL_OPTIONS[stored]) {
            return stored;
        }
    }

    if (lockedModelKey && BATTLE_IMAGE_MODEL_OPTIONS[lockedModelKey]) {
        return lockedModelKey;
    }

    return DEFAULT_BATTLE_IMAGE_MODEL_KEY;
}

export function setSelectedBattleImageModelKey(battleId, modelKey) {
    if (!battleId || !BATTLE_IMAGE_MODEL_OPTIONS[modelKey]) return;
    const map = readSelectionMap();
    map[battleId] = modelKey;
    writeSelectionMap(map);
}

function isModelSelectionLocked(battle) {
    const state = getBattleImageState(battle);
    return state !== "idle";
}

function buildModelToggleMarkup(battle) {
    const selectedModelKey = getSelectedBattleImageModelKey(battle);
    const locked = isModelSelectionLocked(battle);

    return `
        <div class="battle-image-slot__model-picker" aria-label="배틀 이미지 모델 선택">
            ${Object.entries(BATTLE_IMAGE_MODEL_OPTIONS).map(([modelKey, option]) => `
                <button
                    type="button"
                    class="battle-image-slot__model-toggle ${selectedModelKey === modelKey ? "is-active" : ""}"
                    data-action="battle-image-model-select"
                    data-model-key="${escapeHtml(modelKey)}"
                    ${locked ? "disabled" : ""}
                >
                    ${escapeHtml(option.label)}
                </button>
            `).join("")}
        </div>
    `;
}

function buildSelectionStatusText(battle, rawState) {
    const modelKey = getSelectedBattleImageModelKey(battle);
    const option = getBattleImageModelOption(modelKey);
    const costFrames = Number(battle?.battleImage?.costFrames || battle?.costFrames || option.costFrames || 0);

    if (rawState === "queued") {
        return `현재 ${option.shortStatus}로 생성 대기 중 · ${costFrames}프레임`;
    }

    if (rawState === "processing" || rawState === "called") {
        return `현재 ${option.shortStatus}로 생성 중 · ${costFrames}프레임`;
    }

    if (rawState === "done") {
        return `현재 ${option.shortStatus}로 생성 완료`;
    }

    if (rawState === "error") {
        return `현재 ${option.shortStatus}로 생성 실패`;
    }

    return `현재 ${option.shortStatus} 선택됨 · ${option.costFrames}프레임`;
}

export function getBattleImageState(battle) {
    const battleImage = battle?.battleImage || null;
    const hasCalled = battle?.image === "called" || battle?.imageCalled === true;

    if (battleImage?.status === "done" && battleImage?.url) return "done";
    if (battleImage?.status === "error") return "error";
    if (battleImage?.status === "processing") return "processing";
    if (battleImage?.status === "queued") return "queued";
    if (hasCalled) return "called";
    return "idle";
}

export function getBattleImageUiState(battle) {
    const state = getBattleImageState(battle);
    if (state === "done") return "done";
    if (state === "error") return "error";
    if (state === "idle") return "idle";
    return "pending";
}

export function canRequestBattleImage(battle) {
    if (!battle || battle.status !== "done") return false;
    const uiState = getBattleImageUiState(battle);
    return uiState === "idle";
}

export function shouldPollBattleImage(battle) {
    if (!battle || battle.status !== "done") return false;
    const state = getBattleImageState(battle);
    return state === "called" || state === "queued" || state === "processing";
}

function getBattleImageCopy(battle) {
    const rawState = getBattleImageState(battle);
    const uiState = getBattleImageUiState(battle);
    const errorMessage =
        battle?.battleImage?.error?.message ||
        battle?.battleImage?.error?.code ||
        "배틀 이미지 생성에 실패했습니다.";
    const selectionStatus = buildSelectionStatusText(battle, rawState);

    if (uiState === "idle") {
        return {
            rawState,
            uiState,
            eyebrow: "배틀 이미지",
            title: "전투 장면 생성",
            description: "배틀 로그를 바탕으로 전투 이미지를 생성합니다.",
            selectionStatus,
            buttonLabel: "배틀 이미지 생성",
        };
    }

    if (uiState === "pending") {
        const title = rawState === "queued" ? "생성 대기 중" : "생성 중";
        const description =
            rawState === "queued"
                ? "생성 작업을 준비하고 있습니다."
                : "전투 이미지를 만들고 있습니다.";

        return {
            rawState,
            uiState,
            eyebrow: "배틀 이미지",
            title,
            description,
            selectionStatus,
            buttonLabel: "",
        };
    }

    if (uiState === "error") {
        return {
            rawState,
            uiState,
            eyebrow: "배틀 이미지",
            title: "생성 실패",
            description: errorMessage,
            selectionStatus,
            buttonLabel: "",
        };
    }

    return {
        rawState,
        uiState,
        eyebrow: "배틀 이미지",
        title: "생성 완료",
        description: "",
        selectionStatus,
        buttonLabel: "",
    };
}

export function buildBattleImageSection(battle) {
    if (battle?.status !== "done") return "";

    const uiState = getBattleImageUiState(battle);
    const imageUrl = battle?.battleImage?.url || "";

    if (uiState === "done" && imageUrl) {
        return `
            <section class="battle-image-slot battle-image-slot--done" aria-label="배틀 이미지">
                <img class="battle-image-slot__media" src="${escapeHtml(imageUrl)}" alt="battle image" />
            </section>
        `;
    }

    const copy = getBattleImageCopy(battle);
    const canRequest = canRequestBattleImage(battle);

    return `
        <section class="battle-image-slot battle-image-slot--${copy.uiState}" data-battle-image-state="${copy.rawState}">
            <div class="battle-image-slot__inner">
                <div class="battle-image-slot__skeleton" aria-hidden="true"></div>
                ${buildModelToggleMarkup(battle)}
                <div class="battle-image-slot__content">
                    <div class="battle-image-slot__eyebrow">${escapeHtml(copy.eyebrow)}</div>
                    <p class="battle-image-slot__mode-status">${escapeHtml(copy.selectionStatus)}</p>
                    <h3 class="battle-image-slot__title">${escapeHtml(copy.title)}</h3>
                    <p class="battle-image-slot__desc">${escapeHtml(copy.description)}</p>
                    ${copy.uiState === "pending" ? `
                        <div class="battle-image-slot__loading" aria-hidden="true">
                            <span class="battle-image-slot__spinner"></span>
                        </div>
                    ` : ""}
                    ${copy.buttonLabel ? `
                        <button
                            type="button"
                            class="battle-image-slot__button"
                            data-action="battle-image-request"
                            ${canRequest ? "" : "disabled"}
                        >
                            ${escapeHtml(copy.buttonLabel)}
                        </button>
                    ` : ""}
                </div>
            </div>
        </section>
    `;
}

export function buildPendingBattleImageState(battle, options = {}) {
    const modelKey = options?.modelKey || getSelectedBattleImageModelKey(battle);
    const modelOption = getBattleImageModelOption(modelKey);

    return {
        ...battle,
        image: "called",
        imageCalled: true,
        battleImage: {
            ...(battle?.battleImage || {}),
            latestJobId: battle?.battleImage?.latestJobId || battle?.imageJobId || null,
            status: "queued",
            url: battle?.battleImage?.url || null,
            error: null,
            modelKey,
            costFrames: modelOption.costFrames,
            updatedAt: Date.now(),
        },
    };
}

export function buildErrorBattleImageState(battle, error) {
    return {
        ...battle,
        image: battle?.image,
        imageCalled: battle?.imageCalled,
        battleImage: {
            ...(battle?.battleImage || {}),
            status: "error",
            url: null,
            error: {
                message: error?.message || "배틀 이미지 생성에 실패했습니다.",
            },
            updatedAt: Date.now(),
        },
    };
}

export async function requestBattleImageQueue(battleId, options = {}) {
    const modelKey = options?.modelKey;
    const res = await apiFetch("/base/battle-image-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ battleId, modelKey }),
    });

    let json = null;
    try {
        json = await res.json();
    } catch {
        json = null;
    }

    if (!res.ok || json?.ok === false) {
        throw new Error(json?.message || json?.error || "배틀 이미지 요청에 실패했습니다.");
    }

    return json;
}

export async function requestBattleImageStatus({ battleId, jobId }) {
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
        throw new Error(json?.message || json?.error || "배틀 이미지 상태 조회에 실패했습니다.");
    }

    return json;
}

export function mergeBattleImageStatusIntoBattle(battle, statusRes) {
    const next = {
        ...(battle || {}),
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
        modelKey:
            statusRes?.battleImage?.modelKey ||
            statusRes?.modelKey ||
            battle?.battleImage?.modelKey ||
            null,
        costFrames:
            Number(statusRes?.battleImage?.costFrames || statusRes?.costFrames || battle?.battleImage?.costFrames || 0) ||
            getBattleImageModelOption(
                statusRes?.battleImage?.modelKey || statusRes?.modelKey || battle?.battleImage?.modelKey || DEFAULT_BATTLE_IMAGE_MODEL_KEY
            ).costFrames,
        updatedAt:
            statusRes?.battleImage?.updatedAt ||
            battle?.battleImage?.updatedAt ||
            Date.now(),
    };

    return next;
}
