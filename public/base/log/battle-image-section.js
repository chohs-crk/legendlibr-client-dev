import { apiFetch } from "/base/api.js";

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getOwnedCharacterIds() {
    const raw = sessionStorage.getItem("homeCharacters");
    if (!raw) return new Set();

    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return new Set();

        return new Set(
            list
                .map((item) => item?.id)
                .filter((id) => typeof id === "string" && id)
        );
    } catch {
        return new Set();
    }
}

export function isBattleImageOwnerView(battle) {
    if (!battle) return false;

    const ownedIds = getOwnedCharacterIds();
    if (!ownedIds.size) return false;

    return ownedIds.has(battle.myId) || ownedIds.has(battle.enemyId);
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
    if (!isBattleImageOwnerView(battle)) return false;

    const uiState = getBattleImageUiState(battle);
    return uiState === "idle" || uiState === "error";
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

    if (uiState === "idle") {
        return {
            rawState,
            uiState,
            eyebrow: "배틀 이미지",
            title: "전투 장면 생성",
            description: "배틀 로그를 바탕으로 전투 이미지를 생성합니다.",
            buttonLabel: isBattleImageOwnerView(battle) ? "배틀 이미지 생성" : "",
        };
    }

    if (uiState === "pending") {
        const title =
            rawState === "queued"
                ? "생성 대기 중"
                : rawState === "called"
                    ? "로드 중"
                    : "생성 중";
        const description =
            rawState === "queued"
                ? "생성 작업을 준비하고 있습니다."
                : rawState === "called"
                    ? "생성된 배틀 이미지를 불러오고 있습니다."
                    : "전투 이미지를 만들고 있습니다.";

        return {
            rawState,
            uiState,
            eyebrow: "배틀 이미지",
            title,
            description,
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
            buttonLabel: isBattleImageOwnerView(battle) ? "다시 생성하기" : "",
        };
    }

    return {
        rawState,
        uiState,
        eyebrow: "배틀 이미지",
        title: "생성 완료",
        description: "",
        buttonLabel: "",
    };
}

function buildBattleImagePreviewSkeleton(uiState) {
    const isStatic = uiState === "idle" || uiState === "pending";

    return `
        <div class="battle-image-slot__preview ${isStatic ? "battle-image-slot__preview--static" : ""}" aria-hidden="true">
            <div class="battle-image-slot__preview-glow"></div>
            <div class="battle-image-slot__preview-card battle-image-slot__preview-card--left"></div>
            <div class="battle-image-slot__preview-slash"></div>
            <div class="battle-image-slot__preview-card battle-image-slot__preview-card--right"></div>
            <div class="battle-image-slot__preview-caption"></div>
        </div>
    `;
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
                ${buildBattleImagePreviewSkeleton(copy.uiState)}
                <div class="battle-image-slot__content">
                    <div class="battle-image-slot__eyebrow">${escapeHtml(copy.eyebrow)}</div>
                    <h3 class="battle-image-slot__title">${escapeHtml(copy.title)}</h3>
                    <p class="battle-image-slot__desc">${escapeHtml(copy.description)}</p>
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

export function buildPendingBattleImageState(battle) {
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
            updatedAt: Date.now(),
        },
    };
}

export function buildErrorBattleImageState(battle, error) {
    return {
        ...battle,
        image: null,
        imageCalled: false,
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

export async function requestBattleImageQueue(battleId) {
    const res = await apiFetch("/base/battle-image-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ battleId }),
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
            statusRes?.status ||
            statusRes?.battleImage?.status ||
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
            Date.now(),
    };

    return next;
}
