// /base/app-router.js
// 라우터 "오케스트레이션"만 담당: (DOM 활성화 + stack/history 연결 + init 호출)
// 세부 책임(설정/스택/partial 로딩/init)은 /base/router/* 로 분리

import { PAGE_OPTIONS, makeEntry, parseInitialRoute, PUBLIC_PAGES, buildPath } from "./router/route-config.js";
import {
    loadStack,
    saveStack,
    getTop,
    isSameEntry,
    findLastAnchor,
    cutStackToTarget,
} from "./router/route-stack.js";
import { ensurePageMounted } from "./router/page-loader.js";
import { initPage } from "./router/page-init.js";

export { parseInitialRoute } from "./router/route-config.js";

const PAGE_TRANSITION_MS = 300;
let isPageTransitioning = false;

function getAuthState() {
    const user = window.__authUser || null;
    const uid = sessionStorage.getItem("uid");

    if (user) {
        return {
            isAuthed: true,
            user,
        };
    }

    if (uid) {
        return {
            isAuthed: true,
            user: { uid },
        };
    }

    return {
        isAuthed: false,
        user: null,
    };
}

/* =======================================
   SCROLL
======================================= */
function scrollToTop() {
    const activePage = document.querySelector(".page.active");
    if (!activePage) return;
    const scrollArea = activePage.querySelector(".scroll-area");
    if (scrollArea) scrollArea.scrollTop = 0;
    else window.scrollTo(0, 0);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =======================================
   PAGE HOOK
======================================= */
let currentPageName = null;
const pageHooks = {};
window.registerPageHooks = function (name, hooks) {
    pageHooks[name] = hooks;
};

function deactivateAllPages() {
    document.querySelectorAll(".page").forEach((el) => {
        el.classList.remove(
            "active",
            "page-entering",
            "page-active-fade",
            "page-leaving",
            "page-transitioning"
        );
    });
}

async function activatePage(name, { animate = true } = {}) {
    const nextPage = document.getElementById("page-" + name);
    if (!nextPage) return null;

    const currentPage = document.querySelector(".page.active");

    if (currentPage === nextPage) return nextPage;

    if (!animate || !currentPage) {
        deactivateAllPages();
        nextPage.classList.add("active");
        return nextPage;
    }

    nextPage.classList.remove("page-leaving", "page-active-fade");
    nextPage.classList.add("active", "page-entering", "page-transitioning");

    currentPage.classList.remove("page-entering", "page-active-fade");
    currentPage.classList.add("page-leaving", "page-transitioning");

    nextPage.getBoundingClientRect();

    requestAnimationFrame(() => {
        nextPage.classList.add("page-active-fade");
    });

    await wait(PAGE_TRANSITION_MS);

    currentPage.classList.remove("active", "page-leaving", "page-transitioning");
    nextPage.classList.remove("page-entering", "page-active-fade", "page-transitioning");

    return nextPage;
}

function preparePageBeforeInit(name, { fromPop = false } = {}) {
    if (typeof pageHooks[name]?.beforeInit === "function") {
        pageHooks[name].beforeInit({ fromPop });
    }

    // character-view는 init 전에 스켈레톤/초기 상태를 먼저 넣어둬야
    // 이전 캐릭터 DOM이 잠깐 노출되는 문제를 줄일 수 있다.
    if (name === "character-view") {
        const img = document.getElementById("charImage");
        const nameBox = document.getElementById("charName");
        const intro = document.getElementById("charIntroBox");
        const content = document.getElementById("content");

        if (img) img.src = "/images/base/base_01.png";
        if (nameBox) nameBox.textContent = "";
        if (intro) intro.innerHTML = "";
        if (content) content.innerHTML = "";
    }

    // home도 전환 전에 기존 리스트를 비우고 스켈레톤이 바로 들어갈 수 있게 준비
    if (name === "home") {
        const list = document.getElementById("charList");
        if (list) {
            list.innerHTML = "";
            list.style.opacity = "1";
        }
    }

    // character-arcana도 페이지 진입 전에 이전 카드가 보이지 않도록
    // 제목/카운트/리스트를 즉시 초기화해 스켈레톤 상태를 먼저 보여준다.
    if (name === "character-arcana") {
        const titleEl = document.getElementById("arcanaTitle");
        const descEl = document.getElementById("arcanaDesc");
        const countEl = document.getElementById("arcanaCount");
        const listEl = document.getElementById("arcanaList");

        if (titleEl) titleEl.textContent = "아르카나";
        if (descEl) descEl.textContent = "전투의 여운을 카드로 새기는 중입니다.";
        if (countEl) countEl.textContent = "...";
        if (listEl) {
            listEl.innerHTML = `
                <div class="arcana-list arcana-list-grid">
                    ${Array.from({ length: 6 }).map(() => `
                        <div class="arcana-card arcana-card-face skeleton" aria-hidden="true">
                            <div class="arcana-card-frame">
                                <div class="skeleton-line short"></div>
                                <div class="skeleton-block arcana-skeleton-block"></div>
                                <div class="skeleton-line"></div>
                                <div class="skeleton-line medium"></div>
                            </div>
                        </div>
                    `).join("")}
                </div>
            `;
        }
    }
}

/* =======================================
   ROUTER CORE
======================================= */
export async function showPage(name, options = {}) {
    let { fromPop = false, type = "push", charId = null, battleId = null } = options;

    if (isPageTransitioning) return;
    isPageTransitioning = true;

    try {
        const { isAuthed } = getAuthState();

        if (!isAuthed && !PUBLIC_PAGES.has(name)) {
            const currentPath = location.pathname + location.search + location.hash;
            sessionStorage.setItem("loginRedirect", currentPath || "/");

            location.href = "/base/login.html";
            return;
        }

        if (name === "character-image" && !charId) {
            charId = sessionStorage.getItem("viewCharId") || null;
        }

        const pageOpt = PAGE_OPTIONS[name] || {};
        const shouldInit = !fromPop || pageOpt.reinitOnBack === true;
        const shouldScrollTop = !fromPop || pageOpt.scrollTopOnBack === true;
        const shouldBlockEnterUntilReady = shouldInit && pageOpt.blockingLoadBeforeEnter === true;

        if (currentPageName && pageHooks[currentPageName]?.onHide) {
            pageHooks[currentPageName].onHide();
        }

        if (shouldBlockEnterUntilReady) {
            window.__startGlobalLoading?.();
        }

        await ensurePageMounted(name);

        // init가 실제로 실행되는 경우에만 초기 표시 상태를 비운다.
        // 그렇지 않으면 back 복귀 시 기존 DOM만 지워지고 다시 채워지지 않는 문제가 생긴다.
        if (shouldInit) {
            preparePageBeforeInit(name, { fromPop });
        }

        const initPromise = shouldInit
            ? Promise.resolve(initPage(name, { charId, battleId }))
            : Promise.resolve();

        if (shouldBlockEnterUntilReady) {
            await initPromise;
        }

        const shouldAnimate = !!currentPageName;
        const page = await activatePage(name, { animate: shouldAnimate });

        if (!page) {
            console.warn("[router] unknown page:", name);
            return;
        }

        const app = document.querySelector(".app");
        if (app) {
            app.classList.toggle("home-active", name === "home");
        }

        let stack = loadStack();
        const entry = makeEntry(name, { charId, battleId });

        if (type === "tab") {
            stack = [entry];
            saveStack(stack);
            history.replaceState({ page: name }, "", entry.path);
        } else if (type === "replace") {
            if (stack.length === 0) stack = [entry];
            else stack[stack.length - 1] = entry;
            saveStack(stack);
            history.replaceState({ page: name }, "", entry.path);
        } else {
            const top = getTop(stack);
            if (!isSameEntry(top, entry)) {
                stack.push(entry);

                if (name === "character-image") {
                    const anchor = findLastAnchor(stack);
                    if (anchor) {
                        stack[stack.length - 1].backTarget = {
                            name: anchor.name,
                            charId: anchor.charId || null,
                            battleId: anchor.battleId || null,
                        };
                    }
                }

                saveStack(stack);
            }
            history.pushState({ page: name }, "", entry.path);
        }

        if (shouldScrollTop) {
            scrollToTop();
            requestAnimationFrame(scrollToTop);
        }

        if (!shouldBlockEnterUntilReady) {
            await initPromise;
        }

        currentPageName = name;
        window.__currentPageName = name;

        if (pageHooks[name]?.onShow) pageHooks[name].onShow();

        window.__setChromeActive?.(name);
        window.__updateBackBtn?.();
    } finally {
        window.__stopGlobalLoading?.();
        isPageTransitioning = false;
    }
}

window.showPage = showPage;

/* =======================================
   BROWSER POPSTATE
======================================= */
window.addEventListener("popstate", () => {
    const r = parseInitialRoute();
    const entry = makeEntry(r.name, {
        charId: r.charId || null,
        battleId: r.battleId || null,
    });

    saveStack([entry]);

    window.showPage(r.name, {
        fromPop: true,
        type: "replace",
        charId: r.charId || null,
        battleId: r.battleId || null,
    });
});

/* =======================================
   APP BACK API
======================================= */
window.__appBack = function () {
    const stack = loadStack();
    if (stack.length <= 1) return;

    const cur = stack[stack.length - 1];

    if (cur?.backTarget) {
        const next = cutStackToTarget(stack, cur.backTarget);
        if (next) {
            saveStack(next);
            const top = next[next.length - 1];

            window.showPage(top.name, {
                fromPop: true,
                type: "replace",
                charId: top.charId || null,
                battleId: top.battleId || null,
            });

            return;
        }
    }

    stack.pop();
    saveStack(stack);

    const prev = stack[stack.length - 1];
    window.showPage(prev.name, {
        fromPop: true,
        type: "replace",
        charId: prev.charId || null,
        battleId: prev.battleId || null,
    });
};

/* =======================================
   GLOBAL LOADING (기존 유지)
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