import { ORIGINS_FRONT } from "./origins.front.js";
import { apiFetch } from "/base/api.js";

export async function initCreatePromptPage() {
    const $ = (s) => document.querySelector(s);

    /* ==========================
       🔥 서버 생성 상태 확인
    ========================== */
   


    /* ==========================
       🔽 기존 로직 유지
    ========================== */
    $("#nameInput").value = "";
    $("#promptInput").value = "";


    /* ==========================
       클라이언트 스토리 세션 리셋
    ========================== */
    function resetClientStorySession() {
        sessionStorage.removeItem("story_log");
        sessionStorage.removeItem("choices_backup_story1");
     
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
    try {
        const res = await apiFetch("/create/story-check");
        const j = await res.json();


        if (j.ok) {
            // 🔥 final + FF 인 경우만 final 이동
            if (j.isFinalFF) {
                location.href = "/create/create-final.html";
                return;
            }

            // ❌ 그 외 세션 존재 → 생성 불가
            if (j.flow) {

                if (j.flow === "final") {
                    alert("이미 최종 생성 단계에 있는 캐릭터가 있습니다.");
                    return;
                }

                const go = confirm("진행 중인 생성이 있습니다.\n해당 단계로 이동하시겠습니까?");
                if (go) {
                    window.location.href = "/create/create-story.html";
                    return;
                } else {
                    return; // 아무 것도 안 함
                }
            }

        }
    } catch (e) {
        console.warn("story-check failed:", e);
    }
    const nameInput = $("#nameInput");
    const promptInput = $("#promptInput");
    const btnNext = $("#btnNext");

    btnNext.onclick = async () => {
        // 🔒 서버 세션 존재 여부 확인
        const checkRes = await apiFetch("/create/story-check");
        const check = await checkRes.json();

        if (check.ok && check.flow) {

            if (check.flow === "final") {

                // 🔥 30초 초과 시 재생성 허용
                if (check.canRecreateFinal) {
                    const go = confirm("이전 최종 생성이 중단되었습니다.\n새로 생성하시겠습니까?");
                    if (!go) return;
                } else {
                    alert("이미 최종 생성 단계에 있습니다.\n잠시 후 다시 시도해주세요.");
                    return;
                }
            }


            const go = confirm("기존 생성 세션을 초기화하고 새로 시작하시겠습니까?");
            if (!go) return;

            // 🔥 서버에서 자동 삭제되므로 그냥 진행
        }


        // ⬇️ 기존 생성 로직 그대로
        const name = nameInput.value.trim();
        const prompt = promptInput.value.trim();

        if (name.length < 1 || name.length > 20) {
            alert("이름은 1~20자이어야 합니다.");
            return;
        }
        if (prompt.length < 1 || prompt.length > 1000) {
            alert("프롬프트는 1~1000자이어야 합니다.");
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
                if (json.error === "INSUFFICIENT_SCROLL") {
                    alert("두루마리가 부족합니다.");
                    return;
                }

                alert("서버 응답 오류: " + json.error);
                return;
            }

            // 🔥 userMeta 즉시 반영 (DB 재조회 방지)
            if (json.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(json.userMeta));
                window.__updateChromeResource?.(json.userMeta);
            }

            // 🔥 이동
            window.location.href = "/create/create-story.html";


        } catch (err) {
            console.error(err);
            alert("서버 요청 중 오류 발생");
        }
    };
}
