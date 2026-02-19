import { apiFetchUserMeta } from "/base/character-view.api.js";
import { handleBackAction } from "/base/back-handler.js";
/* =========================
   USER META
========================= */
async function ensureUserMeta() {
    const cached = sessionStorage.getItem("userMeta");
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch {
            sessionStorage.removeItem("userMeta");
        }
    }

    const res = await apiFetchUserMeta();
    if (!res.ok) throw new Error("user-meta fetch failed");

    const meta = await res.json();
    sessionStorage.setItem("userMeta", JSON.stringify(meta));
    return meta;
}

/* =========================
   BACK BUTTON VISIBILITY
========================= */
function updateBackButtonVisibility() {
    const btnBack = document.getElementById("btnBack");
    if (!btnBack) return;

    const stack = window.__appStack || [];

    // 🔥 stack 기반 판단
    if (stack.length <= 1) {
        btnBack.style.display = "none";
        return;
    }

    btnBack.style.display = "";
}



// 전역 공개
window.__updateBackBtn = updateBackButtonVisibility;

/* =========================
   TOP BAR
========================= */
function renderTopBar(meta, mode) {
    const btnBack = document.getElementById("btnBack");
    const topExtra = document.getElementById("topExtra");
    if (!topExtra) return;

    if (mode === "resource-only" && btnBack) {
        btnBack.style.display = "none";
    }

    topExtra.innerHTML = `
        <div class="top-right">
            <div class="currency-item scroll">
                <svg class="currency-icon">
                    <use href="/images/base/icons.svg#icon-currency-scroll"></use>
                </svg>
                <span>${Number(meta.scroll).toLocaleString()}</span>
            </div>

            <div class="currency-item frame">
                <svg class="currency-icon">
                    <use href="/images/base/icons.svg#icon-currency-frame"></use>
                </svg>
                <span>${Number(meta.frame).toLocaleString()}</span>
            </div>
        </div>
    `;
}

/* =========================
   FOOTER CONFIG
========================= */
const TAB_CONFIG = {
    tabHome: { page: "home" },
    tabJourney: { page: "journey" },
    tabRank: { page: "ranking" },
    tabSetting: { page: "setting" },
    tabShop: { page: null }
};

/* =========================
   FOOTER ACTIVE CONTROL
========================= */
function setActiveTab(pageName) {
    Object.keys(TAB_CONFIG).forEach(id => {
        document.getElementById(id)?.classList.remove("active");
    });

    const target = Object.entries(TAB_CONFIG)
        .find(([, cfg]) => cfg.page === pageName);

    if (target) {
        document.getElementById(target[0])?.classList.add("active");
    }
}

window.__setChromeActive = setActiveTab;

/* =========================
   FOOTER INIT
========================= */
function initFooter() {
    Object.entries(TAB_CONFIG).forEach(([id, cfg]) => {
        const btn = document.getElementById(id);
        if (!btn || btn.dataset.bound) return;

        btn.dataset.bound = "1";
        btn.addEventListener("click", () => {
            if (cfg.page) {
                // 🔥 footer 이동은 tab 이동
                window.showPage?.(cfg.page, { type: "tab" });
            } else {
                alert("상점은 아직 준비 중입니다!");
            }
        });
    });
}

/* =========================
   SAFE PADDING
========================= */
function applyFooterSafePadding() {
    const footer = document.querySelector(".tab-footer");
    const scrollArea = document.querySelector(".scroll-area");
    if (!footer || !scrollArea) return;

    const footerHeight = footer.offsetHeight;
    const buffer = Math.max(40, window.innerHeight * 0.08);
    scrollArea.style.paddingBottom = `${footerHeight + buffer}px`;
}

window.addEventListener("resize", applyFooterSafePadding);
window.addEventListener("orientationchange", applyFooterSafePadding);
document.addEventListener("DOMContentLoaded", applyFooterSafePadding);
window.__updateChromeResource = function (meta) {
    const scrollEl = document.querySelector(".currency-item.scroll span");
    const frameEl = document.querySelector(".currency-item.frame span");

    if (scrollEl) scrollEl.textContent = Number(meta.scroll).toLocaleString();
    if (frameEl) frameEl.textContent = Number(meta.frame).toLocaleString();
};

/* =========================
   INIT
========================= */
export function initChrome(options = {}) {
    const { mode = "back+resource", onBack } = options;
    const btnBack = document.getElementById("btnBack");

    if (mode !== "resource-only" && btnBack && !btnBack.dataset.bound) {
        btnBack.dataset.bound = "1";
        btnBack.addEventListener("click", () => {
            handleBackAction();
        });
    }

    ensureUserMeta()
        .then(meta => renderTopBar(meta, mode))
        .catch(() => { });

    initFooter();
    updateBackButtonVisibility();
}
