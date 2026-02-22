// /base/router/route-config.js
// 라우터가 "어디로 가는가"를 정의하는 순수 설정/유틸 모듈 (DOM/스토리지/히스토리 로직 없음)

export const PAGES = [
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
  "battle-log",
];

export const PAGE_OPTIONS = {
  home: { reinitOnBack: true,  scrollTopOnBack: true  },
  ranking: { reinitOnBack: false, scrollTopOnBack: true  },
  "character-view": { reinitOnBack: false, scrollTopOnBack: false },
  "battle-log": { reinitOnBack: false, scrollTopOnBack: false },
};

export const ANCHOR_PAGES = new Set(["home", "journey", "ranking", "setting"]);

const PARTIALS = Object.fromEntries(
  PAGES.map((name) => [name, `/base/router/pages/${name}.html`])
);

export function getPartialUrl(name) {
  return PARTIALS[name] || null;
}

/* =======================================
   PATH BUILDING (복사/새탭 URL 고정)
======================================= */
export function buildPath(name, options = {}) {
    if (name === "home") return "/";

    // 동적 ID 페이지
    if (name === "battle-log") {
        if (options?.battleId) return `/battle/${options.battleId}`;
        return "/";
    }

    if (name === "character-view") {
        if (options?.charId) return `/character/${options.charId}`;
        return "/";
    }

    if (name === "character-image") {
        if (options?.charId) return `/character/${options.charId}`;
        const sid = sessionStorage.getItem("viewCharId");
        if (sid) return `/character/${sid}`;
        return "/";
    }

    // ✅ 여기부터 핵심
    // PAGES에 등록된 일반 페이지는 자동으로 /pageName
    if (PAGES.includes(name)) {
        return `/${name}`;
    }

    return "/";
}

/* =======================================
   PATH → PAGE PARSE (새탭/새로고침)
======================================= */
export function parseInitialRoute(pathname = location.pathname) {
  const path = pathname;

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

export function makeEntry(name, { charId = null, battleId = null } = {}) {
  return {
    name,
    charId,
    battleId,
    path: buildPath(name, { charId, battleId }),
    isAnchor: ANCHOR_PAGES.has(name),
    // backTarget: 특정 페이지에서 “뒤로가기 목표” 강제할 때 사용
    backTarget: null,
  };
}
