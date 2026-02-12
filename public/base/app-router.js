// /base/app-router.js
import { initHomePage } from "/base/home.js";
import { initCharacterViewPage } from "/base/character-view.view.js";
import { initCreatePromptPage } from "/create/create-prompt.js";
import { initRankingPage } from "/rank/ranking-view.js";
import { initJourneyPage } from "/base/journey.js";
import { initSettingPage } from "/base/setting.js";
import { initCreateRegionPage } from "/create/create-region.js";

/* =======================================
   PAGE MAP
======================================= */
const pages = [
    "home",
    "journey",
    "battle",
    "setting",
    "create",
    "create-region",
    "create-prompt",
    "ranking",
    "character-view",
    "character-image",
    "battle-log"
];

/* =======================================
   SPA NAV STACK
======================================= */
window.__navStack = ["home"];
let __isHandlingPopState = false;

/* =======================================
   PAGE HOOK (onShow / onHide)
======================================= */
let currentPageName = null;
const pageHooks = {};

// 전역 등록 함수
window.registerPageHooks = function (name, hooks) {
    pageHooks[name] = hooks;
};

/* =======================================
   ROUTER CORE
======================================= */
window.showPage = async function (name, options = {}) {
    const {
        fromPop = false,
        type = "push" // "push" | "tab"
    } = options;

    /* ========== 기존 페이지 onHide 호출 ========== */
    if (currentPageName && pageHooks[currentPageName]?.onHide) {
        pageHooks[currentPageName].onHide();
    }

    /* ========== 페이지 활성화 처리 ========== */
    pages.forEach(p => {
        document.getElementById("page-" + p)?.classList.remove("active");
    });

    const page = document.getElementById("page-" + name);
    if (!page) {
        console.warn("[router] unknown page:", name);
        return;
    }

    page.classList.add("active");

    /* =======================================
       NAV STACK / HISTORY 관리 (안전장치 포함)
    ======================================== */
    if (!fromPop && !__isHandlingPopState) {
        if (type === "tab") {
            window.__navStack = [name];
            history.replaceState({ page: name }, "", `#${name}`);
        } else {
            const last = window.__navStack.at(-1);
            if (last !== name) {
                window.__navStack.push(name);
                history.pushState({ page: name }, "", `#${name}`);
            }
        }
    }

    window.__setChromeActive?.(name);
    window.__updateBackBtn?.();

    /* =======================================
       PAGE INIT - 모든 페이지는 진입마다 init, 
       🔥 단 뒤로가기(fromPop)일 때만 init 제외
    ======================================= */

    if (!fromPop) {
        // ⭐ 공통: 페이지 이동 시 스크롤을 항상 최상단으로
        try {
            const scrollArea = document.querySelector(".scroll-area");
            if (scrollArea) {
                scrollArea.scrollTo({ top: 0, behavior: "auto" });
            } else {
                // fallback: 전체 스크롤
                window.scrollTo({ top: 0, behavior: "auto" });
            }
        } catch { }
        // 🔥 1) 홈 관련
        if (name === "home") await initHomePage();
        if (name === "ranking") await initRankingPage();
        if (name === "journey") initJourneyPage();
        if (name === "setting") initSettingPage();

        // 🔥 2) 배틀 관련
        if (name === "battle") {
            const m = await import("/nbattle/battle.js");
            await m.initBattlePage(false);
        }

        // 🔥 3) 캐릭터 뷰 / 이미지
        if (name === "character-view") await initCharacterViewPage();
        if (name === "character-image") {
            const m = await import("/base/character-image.js");
            await m.initCharacterImagePage();
        }

        // 🔥 4) 생성 플로우 (매번 리셋)
        if (name === "create") resetCreatePageState?.();
        if (name === "create-region") initCreateRegionPage();
        if (name === "create-prompt") await initCreatePromptPage();

        // 🔥 5) 전투 로그
        if (name === "battle-log") {
            const m = await import("/base/battle-log.view.js");
            await m.initBattleLogPage(options?.battle);
        }
    }



    /* ========== 신규 페이지 onShow 호출 ========== */
    currentPageName = name;
    if (pageHooks[name]?.onShow) {
        pageHooks[name].onShow();
    }
};

/* =======================================
   BROWSER BACK / FORWARD
======================================= */
window.addEventListener("popstate", () => {
    __isHandlingPopState = true; // pushState 방지

    if (window.__navStack.length > 1) {
        window.__navStack.pop();
        const prev = window.__navStack.at(-1);
        window.showPage(prev, { fromPop: true });
    } else {
        window.showPage("home", { fromPop: true });
    }

    __isHandlingPopState = false;
    window.__updateBackBtn?.();
});
