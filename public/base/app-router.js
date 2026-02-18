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
window.__appStack = [];

/* =======================================
   PATH BUILDING (🔥 핵심)
======================================= */
function buildPath(name, options = {}) {

    if (name === "home") return "/";
    if (name === "ranking") return "/ranking";
    if (name === "battle-log") {
        if (options?.battleId) {
            return `/battle/${options.battleId}`;
        }
        return "/";
    }

    if (name === "character-view") {
        const id =
            options?.charId ||
            sessionStorage.getItem("viewCharId");

        if (id) return `/character/${id}`;
        return "/";
    }

    // 나머지는 전부 루트
    return "/";
}

/* =======================================
   PATH → PAGE PARSE (🔥 최초 진입 처리)
======================================= */
export function parseInitialRoute() {
    const path = location.pathname;
    if (path.startsWith("/battle/")) {
        const id = path.split("/")[2];
        if (id) {
            sessionStorage.setItem("viewBattleId", id);
            return "battle-log";
        }
    }

    if (path.startsWith("/character/")) {
        const id = path.split("/")[2];
        if (id) {
            sessionStorage.setItem("viewCharId", id);
            return "character-view";
        }
    }

    if (path === "/ranking") return "ranking";

    return "home";
}



/* =======================================
   PAGE HOOK
======================================= */
let currentPageName = null;
const pageHooks = {};

window.registerPageHooks = function (name, hooks) {
    pageHooks[name] = hooks;
};

/* =======================================
   ROUTER CORE
======================================= */
window.showPage = async function (name, options = {}) {

    const {
        fromPop = false,
        type = "push",
        charId = null,
        battleId = null
    } = options;



    const newPath = buildPath(name, { charId, battleId });


    /* ========== 기존 페이지 onHide ========== */
    if (currentPageName && pageHooks[currentPageName]?.onHide) {
        pageHooks[currentPageName].onHide();
    }

    /* ========== 페이지 활성화 ========== */
    pages.forEach(p => {
        document.getElementById("page-" + p)?.classList.remove("active");
    });

    const page = document.getElementById("page-" + name);
    if (!page) {
        console.warn("[router] unknown page:", name);
        return;
    }

    page.classList.add("active");

    if (!fromPop) {

        const newPath = buildPath(name, { charId, battleId });

        // 🔥 footer 이동
        if (type === "tab") {

            window.__appStack = [name];

            history.replaceState({ page: name }, "", newPath);
        }

        // 🔥 일반 push 이동
        else {

            const stack = window.__appStack;
            const existingIndex = stack.lastIndexOf(name);

            if (existingIndex !== -1) {
                // 🔥 이미 존재 → 그 위치까지 자르기
                stack.splice(existingIndex + 1);
                history.replaceState({ page: name }, "", newPath);
            } else {
                stack.push(name);
                history.pushState({ page: name }, "", newPath);
            }
        }
    }





    /* =======================================
       PAGE INIT
    ======================================= */
    if (!fromPop) {

        // 항상 상단 스크롤
        try {
            const scrollArea = document.querySelector(".scroll-area");
            if (scrollArea) {
                scrollArea.scrollTo({ top: 0, behavior: "auto" });
            } else {
                window.scrollTo({ top: 0, behavior: "auto" });
            }
        } catch { }

        // 홈
        if (name === "home") await initHomePage();
        if (name === "ranking") await initRankingPage();
        if (name === "journey") initJourneyPage();
        if (name === "setting") initSettingPage();

        // 배틀
        if (name === "battle") {
            const m = await import("/nbattle/battle.js");
            await m.initBattlePage(false);
        }

        // 캐릭터 뷰
        if (name === "character-view") {
            if (charId) {
                sessionStorage.setItem("viewCharId", charId);
            }
            await initCharacterViewPage();
        }

        // 이미지
        if (name === "character-image") {
            const m = await import("/base/character-image.js");
            await m.initCharacterImagePage();
        }

        // 생성 플로우
        if (name === "create") resetCreatePageState?.();
        if (name === "create-region") initCreateRegionPage();
        if (name === "create-prompt") await initCreatePromptPage();

        // 전투 로그
        if (name === "battle-log") {
            const m = await import("/base/battle-log.view.js");
            await m.initBattleLogPage(options?.battleId);

        }
    }

    /* ========== 신규 onShow ========== */
    currentPageName = name;
    window.__currentPageName = name;

    if (pageHooks[name]?.onShow) {
        pageHooks[name].onShow();
    }
    window.__setChromeActive?.(name);
    window.__updateBackBtn?.();

};

/* =======================================
   BROWSER BACK / FORWARD
======================================= */
window.addEventListener("popstate", () => {

    const page = parseInitialRoute();

    // 🔥 스택 재동기화
    if (window.__appStack.length === 0) {
        window.__appStack = [page];
    } else {
        window.__appStack[window.__appStack.length - 1] = page;
    }

    window.showPage(page, { fromPop: true });
});




/* =======================================
   GLOBAL LOADING
======================================= */
window.__startGlobalLoading = function () {
    const el = document.getElementById("globalLoading");
    if (el) el.style.display = "flex";
    document.body.style.pointerEvents = "none";
};

window.__stopGlobalLoading = function () {
    const el = document.getElementById("globalLoading");
    if (el) el.style.display = "none";
    document.body.style.pointerEvents = "auto";
};
