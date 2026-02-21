// /base/router/page-init.js
// "페이지 초기화(init)" 호출 책임만 담당 (라우팅/DOM 활성화/히스토리/스택 책임 없음)

import { initHomePage } from "../home.js";
import { initJourneyPage } from "../journey.js";
import { initSettingPage } from "../setting.js";
import { initCharacterViewPage } from "../char-view/character-view.view.js";

import { initCreatePromptPage } from "/create/create-prompt.js";
import { initCreateRegionPage } from "/create/create-region.js";
import { initRankingPage } from "/rank/ranking-view.js";

export async function initPage(name, { charId = null, battleId = null } = {}) {
  if (name === "home") return initHomePage();
  if (name === "journey") return initJourneyPage();
  if (name === "setting") return initSettingPage();
  if (name === "ranking") return initRankingPage();

  if (name === "battle") {
    const m = await import("/nbattle/battle.js");
    return m.initBattlePage(false);
  }

  if (name === "character-view") {
    if (charId) sessionStorage.setItem("viewCharId", charId);
    return initCharacterViewPage();
  }

  if (name === "character-image") {
    const m = await import("/base/character-image.js");
    return m.initCharacterImagePage();
  }

  if (name === "create") {
    // 기존 코드가 window.resetCreatePageState에 의존하는 경우를 안전하게 커버
    const m = await import("/create/create.js");
    (m.resetCreatePageState ?? window.resetCreatePageState)?.();
    (m.initCreatePage ?? window.initCreatePage)?.();
    return;
  }

  if (name === "create-region") return initCreateRegionPage();
  if (name === "create-prompt") return initCreatePromptPage();

  if (name === "battle-log") {
    const m = await import("/base/battle-log.view.js");
    return m.initBattleLogPage(battleId);
  }
}
