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
    home: { reinitOnBack: true, scrollTopOnBack: true },
    ranking: { reinitOnBack: false, scrollTopOnBack: true },
    battle: { reinitOnBack: true, scrollTopOnBack: true },
    "character-view": { reinitOnBack: false, scrollTopOnBack: false },
    "battle-log": { reinitOnBack: false, scrollTopOnBack: false },
};

export const ANCHOR_PAGES = new Set(["home", "journey", "ranking", "setting"]);
export const PUBLIC_PAGES = new Set([
    "home",
    "journey",
    "ranking",
    "setting",
    "character-view"
]);
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
    if (name === "journey") return "/journey";
    if (name === "ranking") return "/ranking";
    if (name === "setting") return "/setting";

    if (name === "create") return "/create";
    if (name === "create-region") return "/create-region";
    if (name === "create-prompt") return "/create-prompt";

    // 별도 단일 battle 페이지가 있으면 그 경로를 쓰고,
    // 없으면 보호 페이지 대표 경로 하나를 사용
    if (name === "battle") return "/battle";

    if (name === "battle-log") {
        if (options?.battleId) return `/battle/${options.battleId}`;
        return "/battle";
    }

    if (name === "character-view") {
        if (options?.charId) return `/character/${options.charId}`;
        return "/";
    }

    if (name === "character-image") {
        if (options?.charId) return `/character/${options.charId}/image`;
        const sid = sessionStorage.getItem("viewCharId");
        if (sid) return `/character/${sid}/image`;
        return "/";
    }

    return "/";
}

/* =======================================
   PATH → PAGE PARSE (새탭/새로고침)
======================================= */
export function parseInitialRoute(pathname = location.pathname) {
    const path = pathname;

    if (path === "/") return { name: "home" };
    if (path === "/journey") return { name: "journey" };
    if (path === "/ranking") return { name: "ranking" };
    if (path === "/setting") return { name: "setting" };

    if (path === "/create") return { name: "create" };
    if (path === "/create-region") return { name: "create-region" };
    if (path === "/create-prompt") return { name: "create-prompt" };
    if (path === "/battle") return { name: "battle" };

    if (path.startsWith("/battle/")) {
        const id = path.split("/")[2];
        if (id) return { name: "battle-log", battleId: id };
    }

    if (path.startsWith("/character/") && path.endsWith("/image")) {
        const id = path.split("/")[2];
        if (id) return { name: "character-image", charId: id };
    }

    if (path.startsWith("/character/")) {
        const id = path.split("/")[2];
        if (id) return { name: "character-view", charId: id };
    }

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
