// /base/app-router.js
//✅
import { initHomePage } from "./home.js";
import { initCharacterViewPage } from "./char-view/character-view.view.js";
import { initCreatePromptPage } from "/create/create-prompt.js";
import { initRankingPage } from "/rank/ranking-view.js";
import { initJourneyPage } from "./journey.js";
import { initSettingPage } from "./setting.js";
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
   PAGE OPTIONS
======================================= */
const pageOptions = {
    home: {
        reinitOnBack: true,
        scrollTopOnBack: true
    },
    ranking: {
        reinitOnBack: false,
        scrollTopOnBack: true
    },
    "character-view": {
        reinitOnBack: false,
        scrollTopOnBack: false
    },
    "battle-log": {
        reinitOnBack: false,
        scrollTopOnBack: false
    }
};


/* =======================================
   APP HISTORY (🔥 앱 내부 뒤로가기 전용)
   - 브라우저 밖으로 절대 안 나가게 함
   - footer/tab 이동 시 리셋
======================================= */
function loadAppStack() {
    try {
        const raw = sessionStorage.getItem("__appStackV1");
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function saveAppStack(stack) {
    sessionStorage.setItem("__appStackV1", JSON.stringify(stack));
}

function getTop(stack) {
    return stack.length ? stack[stack.length - 1] : null;
}

function isSameEntry(a, b) {
    if (!a || !b) return false;
    return a.name === b.name
        && (a.charId || null) === (b.charId || null)
        && (a.battleId || null) === (b.battleId || null);
}

/* =======================================
   PATH BUILDING (🔥 복사/새탭 URL 고정)
======================================= */
function buildPath(name, options = {}) {
    if (name === "home") return "/";
    if (name === "ranking") return "/ranking";

    if (name === "battle-log") {
        if (options?.battleId) return `/battle/${options.battleId}`;
        return "/";
    }

    if (name === "character-view") {
        if (options?.charId) return `/character/${options.charId}`;
        return "/";
    }

    // ✅ 핵심: 이미지 편집은 URL을 캐릭터 뷰와 동일하게 유지
    if (name === "character-image") {
        if (options?.charId) return `/character/${options.charId}`;
        // charId 없으면 세션 기반으로도 캐릭터 뷰 URL 유지 시도
        const sid = sessionStorage.getItem("viewCharId");
        if (sid) return `/character/${sid}`;
        return "/";
    }

    return "/";
}


/* =======================================
   PATH → PAGE PARSE (🔥 새탭/새로고침)
======================================= */
export function parseInitialRoute() {
    const path = location.pathname;

    if (path.startsWith("/battle/")) {
        const id = path.split("/")[2];
        if (id) return { name: "battle-log", battleId: id };
    }

    if (path.startsWith("/character/")) {
        const id = path.split("/")[2];
        if (id) return { name: "character-view", charId: id };
    }

    if (path === "/ranking") return { name: "ranking" };

    return { name: "home" };
}

function scrollToTop() {
    const activePage = document.querySelector(".page.active");
    if (!activePage) return;
    const scrollArea = activePage.querySelector(".scroll-area");
    if (scrollArea) scrollArea.scrollTop = 0;
    else window.scrollTo(0, 0);
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
   BACK CHAIN COMPRESSION (🔥 요구사항 3)
   - 예: home -> character-view -> character-image -> character-view 로 이동하면
         back은 character-image가 아니라 home으로
   - 구현: character-image 진입 시, "돌아갈 목표"를 stack의 마지막 anchor로 고정
======================================= */
function findLastAnchor(stack) {
    // anchor = footer 루트(home/journey/ranking/setting) 또는 첫 진입
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.isAnchor) return stack[i];
    }
    return stack[0] || null;
}

function makeEntry(name, { charId = null, battleId = null } = {}) {
    return {
        name,
        charId,
        battleId,
        path: buildPath(name, { charId, battleId }),
        isAnchor: ["home", "journey", "ranking", "setting"].includes(name),
        // backTarget: 특정 페이지에서 “뒤로가기 목표” 강제할 때 사용
        backTarget: null
    };
}

/* =======================================
   ROUTER CORE
======================================= */
window.showPage = async function (name, options = {}) {
    // ✅ charId를 보정해야 해서 let으로 받는다
    let {
        fromPop = false,
        type = "push",        // "push" | "tab" | "replace"
        charId = null,
        battleId = null
    } = options;

    // ✅ character-image는 보통 viewCharId를 이미 갖고 있으니 그걸 사용
    if (name === "character-image" && !charId) {
        charId = sessionStorage.getItem("viewCharId") || null;
    }

    const newPath = buildPath(name, { charId, battleId });

    // ====== onHide ======
    if (currentPageName && pageHooks[currentPageName]?.onHide) {
        pageHooks[currentPageName].onHide();
    }

    // ====== 페이지 활성화 ======
    pages.forEach(p => document.getElementById("page-" + p)?.classList.remove("active"));
    const page = document.getElementById("page-" + name);
    if (!page) {
        console.warn("[router] unknown page:", name);
        return;
    }
    page.classList.add("active");

    // ====== 앱 스택 업데이트 ======
    // fromPop: 브라우저 popstate로 들어온 케이스(새탭/새로고침/브라우저 back/forward)
    // 우리는 “브라우저 뒤로가기” 버튼을 쓰지 않고, 앱 back 버튼은 앱 스택만 사용.
    let stack = loadAppStack();

    const entry = makeEntry(name, { charId, battleId });

    if (type === "tab") {
        // footer 탭 이동: 히스토리/앱 스택 리셋
        stack = [entry];
        saveAppStack(stack);
        history.replaceState({ page: name }, "", newPath);
    } else if (type === "replace") {
        // 현재 entry 교체
        if (stack.length === 0) stack = [entry];
        else stack[stack.length - 1] = entry;
        saveAppStack(stack);
        history.replaceState({ page: name }, "", newPath);
    } else {
        // 일반 push 이동
        const top = getTop(stack);
        if (!isSameEntry(top, entry)) {
            stack.push(entry);

            // ✅ 요구사항 3: character-image는 back target을 “직전이 아니라 anchor”로 강제
            // 즉, character-image로 들어가면 그 이후 back은 anchor로 가도록
            if (name === "character-image") {
                const anchor = findLastAnchor(stack);
                // anchor가 있으면 backTarget을 anchor로 지정
                if (anchor) {
                    stack[stack.length - 1].backTarget = {
                        name: anchor.name,
                        charId: anchor.charId || null,
                        battleId: anchor.battleId || null
                    };
                }
            }

            saveAppStack(stack);
        }
        history.pushState({ page: name }, "", newPath);
    }
    const pageOpt = pageOptions[name] || {};

    const shouldInit =
        !fromPop || pageOpt.reinitOnBack === true;

    const shouldScrollTop =
        !fromPop || pageOpt.scrollTopOnBack === true;

    if (shouldScrollTop) {
        scrollToTop();
        requestAnimationFrame(scrollToTop);
    }


    if (shouldInit) {
        if (name === "home") await initHomePage();
        if (name === "ranking") await initRankingPage();
        if (name === "journey") initJourneyPage();
        if (name === "setting") initSettingPage();

        if (name === "battle") {
            const m = await import("/nbattle/battle.js");
            await m.initBattlePage(false);
        }

        if (name === "character-view") {
            if (charId) sessionStorage.setItem("viewCharId", charId);
            await initCharacterViewPage();
        }

        if (name === "character-image") {
            const m = await import("/base/character-image.js");
            await m.initCharacterImagePage();
        }

        if (name === "create") resetCreatePageState?.();
        if (name === "create-region") initCreateRegionPage();
        if (name === "create-prompt") await initCreatePromptPage();

        if (name === "battle-log") {
            const m = await import("/base/battle-log.view.js");
            await m.initBattleLogPage(battleId);
        }
    }

    // ====== onShow ======
    currentPageName = name;
    window.__currentPageName = name;

    if (pageHooks[name]?.onShow) pageHooks[name].onShow();

    window.__setChromeActive?.(name);
    window.__updateBackBtn?.();
};

/* =======================================
   BROWSER POPSTATE
   - 브라우저 back/forward, 새탭 새로고침 등
   - URL 기준으로만 해석해서 해당 페이지 띄움
   - 앱 스택은 “최소 1개 엔트리”로 동기화 (앱 밖으로 back 금지)
======================================= */
window.addEventListener("popstate", () => {
    const r = parseInitialRoute();
    const entry = makeEntry(r.name, { charId: r.charId || null, battleId: r.battleId || null });

    // popstate로 왔을 때도 “앱 스택”은 URL 상태를 반영
    // (단, 브라우저 밖으로 나가게 만들지 않기 위해 최소 1개 유지)
    saveAppStack([entry]);

    window.showPage(r.name, {
        fromPop: true,
        type: "replace",
        charId: r.charId || null,
        battleId: r.battleId || null
    });
});

/* =======================================
   APP BACK API (chrome/back-handler가 사용)
   - 앱 스택 기반으로만 이동
   - stack이 1이면 아무것도 안 함 (앱 밖으로 안 나감)
======================================= */
window.__appBack = function () {
    const stack = loadAppStack();
    if (stack.length <= 1) {
        // ✅ 절대 앱 밖으로 안 나감
        return;
    }

    const cur = stack[stack.length - 1];

    // ✅ 요구사항 3: backTarget이 있으면 그곳으로 "점프"
    if (cur?.backTarget) {
        const target = cur.backTarget;

        // stack을 anchor(=target)까지 줄이기
        let cutIdx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
            const it = stack[i];
            if (it.name === target.name
                && (it.charId || null) === (target.charId || null)
                && (it.battleId || null) === (target.battleId || null)) {
                cutIdx = i;
                break;
            }
        }
        if (cutIdx >= 0) {
            stack.splice(cutIdx + 1); // target 위는 삭제
            saveAppStack(stack);

            const top = stack[stack.length - 1];
            window.showPage(top.name, {
                fromPop: true,
                type: "replace",
                charId: top.charId || null,
                battleId: top.battleId || null
            });

            return;
        }

    }

    // 일반 back: 1단계 pop
    stack.pop();
    saveAppStack(stack);

    const prev = stack[stack.length - 1];
    window.showPage(prev.name, {
        fromPop: true,
        type: "replace",
        charId: prev.charId || null,
        battleId: prev.battleId || null
    });

};

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
