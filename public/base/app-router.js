import { initHomePage } from "/base/home.js";
import { initCharacterViewPage } from "/base/character-view.view.js";
import { initCreatePromptPage } from "/create/create-prompt.js";
import { initRankingPage } from "/rank/ranking-view.js";
import { initJourneyPage } from "/base/journey.js";
import { initSettingPage } from "/base/setting.js";
import { initCreateRegionPage } from "/create/create-region.js";


const pages = [
    "home",
    "journey",
    "battle",          // ✅ 추가
    "setting",
    "create",
    "create-region",
    "create-prompt",
    "ranking",
    "character-view",
    "character-image"
];


/* =========================
   SPA NAV STACK
========================= */
window.__navStack = ["home"];

/* =========================
   SPA ROUTER
========================= */
window.showPage = async function (name, options = {}) {
    const {
        fromPop = false,
        type = "push" // "push" | "tab"
    } = options;

    // 모든 페이지 숨김
    pages.forEach(p => {
        document.getElementById("page-" + p)?.classList.remove("active");
    });

    const page = document.getElementById("page-" + name);
    if (!page) {
        console.warn("[router] unknown page:", name);
        return;
    }

    page.classList.add("active");

    /* =========================
       NAV STACK 관리
    ========================= */
    if (!fromPop) {
        if (type === "tab") {
            // footer 이동 → 스택 리셋
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

    // chrome 상태 동기화
    window.__setChromeActive?.(name);
    window.__updateBackBtn?.();

    /* =========================
       PAGE INIT
    ========================= */
    if (name === "home") {
        await initHomePage();
    }

    if (name === "ranking") {
        await initRankingPage();
    }

    if (name === "journey") {
        initJourneyPage();
    }
    if (name === "battle") {
        const m = await import("/nbattle/battle.js");

        // 🔥 캐릭터 변경 없이 '페이지 이동만 해도'
        //    매칭 로직을 반드시 다시 돌리기 위해 true로 강제 재실행
        await m.initBattlePage(true);
    }


    if (name === "setting") {
        initSettingPage();
    }

    if (name === "character-view") {
        await initCharacterViewPage();
    }
    if (name === "create") {
        resetCreatePageState?.();
    }

    if (name === "create-prompt") {
        await initCreatePromptPage();
    }

    if (name === "character-image") {
        const m = await import("/base/character-image.js");
        await m.initCharacterImagePage();
    }
    if (name === "create-region") {
        initCreateRegionPage();
    }


};

/* =========================
   BROWSER BACK / FORWARD
========================= */
window.addEventListener("popstate", () => {
    if (window.__navStack.length > 1) {
        window.__navStack.pop();
        const prev = window.__navStack.at(-1);
        window.showPage(prev, { fromPop: true });
    } else {
        window.showPage("home", { fromPop: true });
    }

    window.__updateBackBtn?.();
});
