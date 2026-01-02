import { ORIGINS_FRONT } from "./origins.front.js";
import { apiFetch } from "/base/api.js";

export function initCreatePromptPage() {

    const $ = (s) => document.querySelector(s);

    /* ==========================
       클라이언트 스토리 세션 리셋
    ========================== */
    function resetClientStorySession() {
        sessionStorage.removeItem("story_log");
        sessionStorage.removeItem("choices_backup_story1");
        sessionStorage.removeItem("choices_backup_story2");
        sessionStorage.removeItem("choices_backup_story3");
        sessionStorage.removeItem("aiIntro");
        sessionStorage.removeItem("currentSceneKey");
        sessionStorage.removeItem("displayNameRaw");
    }

    /* ==========================
       세션 검증
    ========================== */
    const originId = sessionStorage.getItem("origin");
    const regionId = sessionStorage.getItem("regionId");
    const regionName = sessionStorage.getItem("regionName");

    if (!originId || !regionId) {
        alert("기원과 지역을 다시 선택해주세요.");
        showPage("create");
        throw new Error("invalid create state");
    }

    const originData = ORIGINS_FRONT[originId];
    if (!originData) {
        alert("잘못된 기원 선택입니다.");
        showPage("create");
        throw new Error("invalid origin");
    }

    $("#originName").textContent = originData.name;
    $("#regionName").textContent = regionName || "알 수 없음";

    const nameInput = $("#nameInput");
    const promptInput = $("#promptInput");
    const btnNext = $("#btnNext");

    btnNext.onclick = async () => {
        const name = nameInput.value.trim();
        const prompt = promptInput.value.trim();

        if (name.length < 1 || name.length > 20) {
            alert("이름은 1~20자이어야 합니다.");
            return;
        }
        if (prompt.length < 1 || prompt.length > 700) {
            alert("프롬프트는 1~700자이어야 합니다.");
            return;
        }

        resetClientStorySession();

        sessionStorage.setItem("displayNameRaw", name);

        const payload = {
            originId,
            regionId,
            displayNameRaw: name,
            prompt
        };

        try {
            const res = await apiFetch("/create/prompt-init", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });


            const json = await res.json();

            if (!json.ok) {
                alert("서버 응답 오류: " + json.error);
                return;
            }

            // 🔥 SPA 이동으로 변경
            window.location.href = "/create/create-story.html";

        } catch (err) {
            console.error(err);
            alert("서버 요청 중 오류 발생");
        }
    };
}
