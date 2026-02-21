// /base/router/bootstrap.js
// 앱 부트스트랩(인증→partial 마운트→초기 라우트 표시)을 담당

import "/base/app-router.js"; // window.showPage, window.__appBack 등 등록
import { mountAllPages } from "./page-loader.js";
import { requireAuthOrRedirect } from "/base/auth.js";
import { parseInitialRoute } from "/base/app-router.js";
import { handleBackAction } from "/base/back-handler.js";

async function loadChrome() {
  const root = document.getElementById("chrome-root");
  if (!root) return;

  const html = await fetch("/base/common/chrome.html").then((r) => r.text());
  root.innerHTML = html;

  const m = await import("/base/common/chrome.js");
  // ✅ back 버튼은 "표시 여부"만 navStack으로 제어하고,
  // ✅ 클릭 동작은 바인딩되도록 resource-only를 쓰지 않는다
  m.initChrome({ mode: "back+resource" });
}

function bindGlobalUI() {
  const dialogBack = document.getElementById("dialogBack");
  dialogBack?.addEventListener("click", handleBackAction);
}

(async function bootstrapApp() {
  try {
    bindGlobalUI();

    // chrome, partial 로드는 인증 전/후 어느 쪽이든 가능하지만
    // 인증이 실패하면 페이지 보여주지 않도록 순서 분리
    await loadChrome();

    await requireAuthOrRedirect();

    // ✅ 기존 index.html처럼 "모든 page DOM은 존재"하게 만든다 (안전/호환성 우선)
    await mountAllPages();

    const route = parseInitialRoute(); // { name, charId?, battleId? }

    window.showPage(route.name, {
      type: "tab",
      charId: route.charId || null,
      battleId: route.battleId || null,
    });
  } catch (e) {
    console.warn("bootstrap 실패:", e?.message || e);
  }
})();
