import { apiFetchUserMeta } from "/base/character-view.api.js";

/* =========================
   TOP BAR
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

function renderTopBar(meta, mode) {
    const btnBack = document.getElementById("btnBack");
    const topExtra = document.getElementById("topExtra");
    if (!topExtra) return;

    if (mode === "resource-only" && btnBack) {
        btnBack.style.display = "none";
        topExtra.insertAdjacentHTML("afterbegin", `
      <span class="top-level left-slot">LV ${meta.level}</span>
    `);
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
   FOOTER
========================= */
const TAB_CONFIG = {
    tabHome: {
        onClick: () => showPage("home")
    },
    tabJourney: {
        onClick: () => showPage("journey")
    },
    tabRank: {
        onClick: () => showPage("ranking")
    },
    tabSetting: {
        onClick: () => showPage("setting")
    },
    tabShop: {
        onClick: () => alert("상점은 아직 준비 중입니다!")
    }
};

function initFooter() {
    const path = location.pathname;

    Object.entries(TAB_CONFIG).forEach(([id, cfg]) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        if (!btn.dataset.bound) {
            btn.dataset.bound = "1";
            btn.addEventListener("click", () => {
                if (cfg.to) location.href = cfg.to;
                else if (cfg.onClick) cfg.onClick();
            });
        }

        if (cfg.activeWhen?.some(r => path === r || path.startsWith(r))) {
            btn.classList.add("active");
        }
    });
}

/* =========================
   INIT (단일 진입점)
========================= */
export function initChrome(options = {}) {
    const { mode = "back+resource", onBack } = options;

    const btnBack = document.getElementById("btnBack");

    // 🔥 mode가 resource-only이면 뒤로가기 버튼 끄기 & 숨기기
    if (mode === "resource-only") {
        if (btnBack) {
            btnBack.style.display = "none";
            btnBack.replaceWith(btnBack.cloneNode(true));
            // → 기존 이벤트 제거용
        }
    }
    // 🔥 그 외 모드는 정상 뒤로가기 버튼 활성화
    else if (btnBack && !btnBack.dataset.bound) {
        btnBack.dataset.bound = "1";
        btnBack.addEventListener("click", () => {
            onBack ? onBack() : history.back();
        });
    }


    ensureUserMeta()
        .then(meta => renderTopBar(meta, mode))
        .catch(() => { });

    initFooter();
}
/* =========================
   FOOTER SCROLL SAFE PADDING (SUPER STABLE)
========================= */
function applyFooterSafePadding() {
    const footer = document.querySelector('.tab-footer');
    const scrollArea = document.querySelector('.scroll-area');
    if (!footer || !scrollArea) return;

    // footer 실제 높이 감지
    const footerHeight = footer.offsetHeight;

    // 안전 여백 (추가 버퍼) — footer 변동 + 모바일 주소창 변동 모두 커버
    const buffer = Math.max(40, window.innerHeight * 0.08);

    // 최종 패딩 적용
    scrollArea.style.paddingBottom = `${footerHeight + buffer}px`;
}

// 화면 사이즈 변화 / 주소창 변화 / 회전 시 재적용
window.addEventListener("resize", applyFooterSafePadding);
window.addEventListener("orientationchange", applyFooterSafePadding);

// 최초 실행
document.addEventListener("DOMContentLoaded", applyFooterSafePadding);
