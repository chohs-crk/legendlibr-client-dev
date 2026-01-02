import { initHomePage } from "/base/home.js";
import { initCharacterViewPage } from "/base/character-view.view.js";
import { initCreatePromptPage } from "/create/create-prompt.js";
// 📌 ranking-view.js 임포트 (경로 확인 필요, 여기서는 /base/ 디렉토리에 있다고 가정)
import { initRankingPage } from "/rank/ranking-view.js";
import { initJourneyPage } from "/base/journey.js";
import { initSettingPage } from "/base/setting.js";
const pages = [
    "home",
    "journey",
    "setting",
    "create",
    "create-prompt",
    "ranking",
    "character-view",
    "character-image"
];

window.showPage = async function (name) {
    // 모든 페이지 숨김 로직
    pages.forEach(p => {
        document.getElementById("page-" + p)?.classList.remove("active");
    });

    const page = document.getElementById("page-" + name);
    if (!page) {
        console.warn("[router] unknown page:", name);
        return;
    }

    page.classList.add("active");
    page.querySelector(".scroll-area")?.scrollTo(0, 0);

    // 📌 페이지별 기능 이식 (추가된 부분)
    if (name === "home") await initHomePage();
    if (name === "ranking") await initRankingPage();
    if (name === "journey") initJourneyPage(); // 여정 기능 연결
    if (name === "setting") initSettingPage(); // 설정(로그아웃) 기능 연결

    if (name === "character-view") await initCharacterViewPage();
    if (name === "create-prompt") await initCreatePromptPage();
    if (name === "character-image") await import("/base/character-image.js");
};