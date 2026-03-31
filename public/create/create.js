import { ORIGINS_FRONT } from "./origins.front.js";
import { openWrap } from "/base/common/ui-wrap.js";
import { apiFetch } from "/base/api.js";

import {
    renderOriginList,
    bindOriginEvents,
    setSelectedOriginItem,
    getExpandArea,
    disableAllNextButtons,
} from "./create-ui/create.origin-ui.js";

import { renderOriginDetail, openRegionDetailModal } from "./create-ui/create.region-ui.js";

/* =========================================
   CREATE PAGE STATE
========================================= */
const state = {
    selectedOrigin: null,
    selectedRegion: null,
};

const STORAGE_KEYS = {
    origin: "origin",
    regionId: "regionId",
    regionName: "regionName",
};

const CREATE_REGION_SUCCESS_STORAGE_KEY = "createRegionSuccessPayload";

function getOriginItemById(originId) {
    return originListEl?.querySelector(`.origin-item[data-value="${originId}"]`) || null;
}

function consumeCreateRegionSuccessPayload() {
    try {
        const raw = sessionStorage.getItem(CREATE_REGION_SUCCESS_STORAGE_KEY);
        if (!raw) return null;

        sessionStorage.removeItem(CREATE_REGION_SUCCESS_STORAGE_KEY);
        return JSON.parse(raw);
    } catch (err) {
        console.error("[create] failed to consume region success payload", err);
        sessionStorage.removeItem(CREATE_REGION_SUCCESS_STORAGE_KEY);
        return null;
    }
}

function showCreateRegionSuccessModal(payload) {
    const region = payload?.region;
    if (!region) return;

    openRegionDetailModal(
        region,
        openWrap,
        `
            <div class="region-create-success-title">생성 성공!</div>
            <div class="region-create-success-subtitle">새 지역 정보가 추가되었습니다.</div>
        `
    );
}

async function selectOriginAndRender(originItemEl, { onAfterRender } = {}) {
    if (!originItemEl) return;

    clearSelectedRegion();
    disableAllNextButtons(document);
    setSelectedOriginItem(originListEl, originItemEl);

    const originId = originItemEl.dataset.value;
    setSelectedOrigin(originId);

    const ui = getExpandArea(originItemEl);

    setOriginLoading(originItemEl, true);
    const loadingStartedAt = Date.now();

    try {
        await renderOriginDetail({
            originId,
            ui,
            origins: ORIGINS_FRONT,
            apiFetch,
            openWrap,
            state,
            setRegion: setSelectedRegion,
            clearRegion: clearSelectedRegion,
            showPage: window.showPage,
        });

        await onAfterRender?.({ originId, ui });
    } finally {
        const elapsed = Date.now() - loadingStartedAt;
        const minSkeletonMs = 220;

        if (elapsed < minSkeletonMs) {
            await new Promise((resolve) => setTimeout(resolve, minSkeletonMs - elapsed));
        }

        setOriginLoading(originItemEl, false);
    }
}

async function restoreCreatedRegionSuccess() {
    const payload = consumeCreateRegionSuccessPayload();
    if (!payload?.originId) return;

    const originItemEl = getOriginItemById(payload.originId);
    if (!originItemEl) return;

    await selectOriginAndRender(originItemEl, {
        onAfterRender: async () => {
            showCreateRegionSuccessModal(payload);
        },
    });
}


function setSelectedOrigin(originId) {
    state.selectedOrigin = originId;
    sessionStorage.setItem(STORAGE_KEYS.origin, originId);
}

function setSelectedRegion(regionId, regionName) {
    state.selectedRegion = regionId;
    sessionStorage.setItem(STORAGE_KEYS.regionId, regionId);
    sessionStorage.setItem(STORAGE_KEYS.regionName, regionName);
}

function clearSelectedRegion() {
    state.selectedRegion = null;
    sessionStorage.removeItem(STORAGE_KEYS.regionId);
    sessionStorage.removeItem(STORAGE_KEYS.regionName);
}

/* =========================================
   DOM
========================================= */
const originListEl = document.getElementById("originList");

function setOriginLoading(originItemEl, isLoading) {
    if (!originItemEl) return;

    const ui = getExpandArea(originItemEl);
    originItemEl.classList.toggle("is-loading", isLoading);
    originItemEl.setAttribute("aria-busy", String(!!isLoading));

    if (!ui) return;

    if (ui.loadingBox) {
        ui.loadingBox.hidden = !isLoading;
    }

    if (ui.contentBox) {
        ui.contentBox.hidden = !!isLoading;
    }
}

/* =========================================
   🔥 CREATE PAGE RESET (SPA router에서 호출)
========================================= */
export function resetCreatePageState() {
    state.selectedOrigin = null;
    state.selectedRegion = null;

    sessionStorage.removeItem(STORAGE_KEYS.origin);
    sessionStorage.removeItem(STORAGE_KEYS.regionId);
    sessionStorage.removeItem(STORAGE_KEYS.regionName);

    document.querySelectorAll(".origin-item").forEach((el) => {
        el.classList.remove("selected", "is-loading");
        el.setAttribute("aria-pressed", "false");
        el.setAttribute("aria-busy", "false");
    });

    document.querySelectorAll(".region-list").forEach((el) => {
        el.innerHTML = "";
        el.style.display = "none";
    });

    document.querySelectorAll(".origin-desc-box").forEach((el) => {
        el.textContent = "";
        el.style.display = "none";
    });

   document.querySelectorAll(".origin-loading-box").forEach((el) => {
       el.hidden = true;
   });

    document.querySelectorAll(".origin-content-box").forEach((el) => {
        el.hidden = false;
    });

    disableAllNextButtons(document);
}

window.resetCreatePageState = resetCreatePageState;

/* =========================================
   INIT
========================================= */
function initCreatePage() {
    if (!originListEl) {
        console.warn("[create] #originList not found. initCreatePage skipped.");
        return;
    }

    renderOriginList(originListEl, ORIGINS_FRONT);

    bindOriginEvents(originListEl, {
        onSelectOrigin: async (originItemEl) => {
            if (originItemEl.classList.contains("selected")) return;
            await selectOriginAndRender(originItemEl);
        },
    });

    restoreCreatedRegionSuccess().catch((err) => {
        console.error("[create] failed to restore region success", err);
    });
}

window.addEventListener("create:region-created", () => {
    restoreCreatedRegionSuccess().catch((err) => {
        console.error("[create] failed to handle region-created event", err);
    });
});

initCreatePage();

/* =========================================
   페이지 등장 애니메이션
========================================= */
window.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
        document.body.classList.add("show");
    });
});
