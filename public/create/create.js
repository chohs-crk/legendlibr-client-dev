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

import { renderOriginDetail } from "./create-ui/create.region-ui.js";

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

/* =========================================
   🔥 CREATE PAGE RESET (SPA router에서 호출)
========================================= */
export function resetCreatePageState() {
    // JS 상태
    state.selectedOrigin = null;
    state.selectedRegion = null;

    // sessionStorage 정리
    sessionStorage.removeItem(STORAGE_KEYS.origin);
    sessionStorage.removeItem(STORAGE_KEYS.regionId);
    sessionStorage.removeItem(STORAGE_KEYS.regionName);

    // DOM 상태 초기화
    document.querySelectorAll(".origin-item").forEach((el) => {
        el.classList.remove("selected");
    });

    document.querySelectorAll(".region-list").forEach((el) => {
        el.innerHTML = "";
        el.style.display = "none";
    });

    document.querySelectorAll(".origin-desc-box").forEach((el) => {
        el.textContent = "";
        el.style.display = "none";
    });

    disableAllNextButtons(document);
}

// SPA router에서 호출 가능하게 노출
window.resetCreatePageState = resetCreatePageState;

/* =========================================
   INIT
========================================= */
function initCreatePage() {
    if (!originListEl) {
        console.warn("[create] #originList not found. initCreatePage skipped.");
        return;
    }

    // ✅ origin 목록 렌더 + 이벤트 바인딩 (기존 create.js에서 하던 작업을 모듈로 분리)
    renderOriginList(originListEl, ORIGINS_FRONT);

    bindOriginEvents(originListEl, {
        onSelectOrigin: async (originItemEl) => {
            // 이미 선택된 기원이라면 noop
            if (originItemEl.classList.contains("selected")) return;

            // 🔥 region / 다음 버튼 상태 리셋
            clearSelectedRegion();

            // 모든 next 버튼 비활성화 (안전)
            disableAllNextButtons(document);

            // UI: 선택 표시
            setSelectedOriginItem(originListEl, originItemEl);

            // 상태 + sessionStorage
            const originId = originItemEl.dataset.value;
            setSelectedOrigin(originId);

            // 확장 영역 참조
            const ui = getExpandArea(originItemEl);

            // 상세 + region 목록 렌더
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
        },
    });
}

// 기존과 동일하게 스크립트 로드 시 초기화
initCreatePage();

/* =========================================
   페이지 등장 애니메이션
========================================= */
window.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
        document.body.classList.add("show");
    });
});
//⚠️