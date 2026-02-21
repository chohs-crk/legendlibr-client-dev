// /base/app-router.js
// 라우터 "오케스트레이션"만 담당: (DOM 활성화 + stack/history 연결 + init 호출)
// 세부 책임(설정/스택/partial 로딩/init)은 /base/router/* 로 분리

import { PAGE_OPTIONS, makeEntry, parseInitialRoute } from "./router/route-config.js";
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

/* =======================================
   PAGE HOOK
======================================= */
let currentPageName = null;
const pageHooks = {};
window.registerPageHooks = function (name, hooks) {
  pageHooks[name] = hooks;
};

function deactivateAllPages() {
  document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
}

function activatePage(name) {
  const page = document.getElementById("page-" + name);
  if (!page) return null;

  deactivateAllPages();
  page.classList.add("active");
  return page;
}

/* =======================================
   ROUTER CORE
======================================= */
export async function showPage(name, options = {}) {
  // ✅ charId를 보정해야 해서 let으로 받는다
  let { fromPop = false, type = "push", charId = null, battleId = null } = options;

  // ✅ character-image는 보통 viewCharId를 이미 갖고 있으니 그걸 사용
  if (name === "character-image" && !charId) {
    charId = sessionStorage.getItem("viewCharId") || null;
  }

  // ====== onHide ======
  if (currentPageName && pageHooks[currentPageName]?.onHide) {
    pageHooks[currentPageName].onHide();
  }

  // ====== HTML partial ensure ======
  await ensurePageMounted(name);

  // ====== 페이지 활성화 ======
  const page = activatePage(name);
  if (!page) {
    console.warn("[router] unknown page:", name);
    return;
  }

  // ====== 앱 스택 업데이트 ======
  let stack = loadStack();
  const entry = makeEntry(name, { charId, battleId });

  if (type === "tab") {
    // footer 탭 이동: 히스토리/앱 스택 리셋
    stack = [entry];
    saveStack(stack);
    history.replaceState({ page: name }, "", entry.path);
  } else if (type === "replace") {
    // 현재 entry 교체
    if (stack.length === 0) stack = [entry];
    else stack[stack.length - 1] = entry;
    saveStack(stack);
    history.replaceState({ page: name }, "", entry.path);
  } else {
    // 일반 push 이동
    const top = getTop(stack);
    if (!isSameEntry(top, entry)) {
      stack.push(entry);

      // ✅ 요구사항: character-image는 back target을 “직전이 아니라 anchor”로 강제
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

  const pageOpt = PAGE_OPTIONS[name] || {};

  const shouldInit = !fromPop || pageOpt.reinitOnBack === true;
  const shouldScrollTop = !fromPop || pageOpt.scrollTopOnBack === true;

  if (shouldScrollTop) {
    scrollToTop();
    requestAnimationFrame(scrollToTop);
  }

  if (shouldInit) {
    await initPage(name, { charId, battleId });
  }

  // ====== onShow ======
  currentPageName = name;
  window.__currentPageName = name;

  if (pageHooks[name]?.onShow) pageHooks[name].onShow();

  window.__setChromeActive?.(name);
  window.__updateBackBtn?.();
}

// 기존 코드 호환: 외부에서 window.showPage를 쓰는 경우를 위해 유지
window.showPage = showPage;

/* =======================================
   BROWSER POPSTATE
   - 브라우저 back/forward, 새탭 새로고침 등
   - URL 기준으로만 해석해서 해당 페이지 띄움
   - 앱 스택은 “최소 1개 엔트리”로 동기화 (앱 밖으로 back 금지)
======================================= */
window.addEventListener("popstate", () => {
  const r = parseInitialRoute();
  const entry = makeEntry(r.name, {
    charId: r.charId || null,
    battleId: r.battleId || null,
  });

  // popstate로 왔을 때도 “앱 스택”은 URL 상태를 반영
  saveStack([entry]);

  window.showPage(r.name, {
    fromPop: true,
    type: "replace",
    charId: r.charId || null,
    battleId: r.battleId || null,
  });
});

/* =======================================
   APP BACK API (chrome/back-handler가 사용)
   - 앱 스택 기반으로만 이동
   - stack이 1이면 아무것도 안 함 (앱 밖으로 안 나감)
======================================= */
window.__appBack = function () {
  const stack = loadStack();
  if (stack.length <= 1) return; // ✅ 절대 앱 밖으로 안 나감

  const cur = stack[stack.length - 1];

  // ✅ backTarget이 있으면 그곳으로 "점프"
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

  // 일반 back: 1단계 pop
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
