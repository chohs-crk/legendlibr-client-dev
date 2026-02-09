// /create/create-region.js
import { apiFetch } from "/base/api.js";
import { ORIGINS_FRONT } from "./origins.front.js";
export function initCreateRegionPage() {
    const $ = (s) => document.querySelector(s);

    /* ==========================
       🔥 재진입 초기화
    ========================== */
    $("#regionNameInput").value = "";
    $("#regionDetailInput").value = "";

    const origin = sessionStorage.getItem("origin");
    if (!origin) {
        alert("기원을 다시 선택해주세요.");
        showPage("create");
        return;
    }

    const originLabel =
        ORIGINS_FRONT[origin]?.name ?? origin;

    $("#regionOriginName").textContent = originLabel;


    const originNameEl = $("#regionOriginName");
    const nameInput = $("#regionNameInput");
    const detailInput = $("#regionDetailInput");
    const btnCancel = $("#btnRegionCancel");
    const btnCreate = $("#btnRegionCreate");

    if (!originNameEl || !nameInput || !detailInput || !btnCancel || !btnCreate) {
        console.warn("[create-region] DOM not ready");
        return;
    }



    // 취소 → 기원/지역 선택으로
    btnCancel.onclick = () => {
        showPage("create");
    };

    // 지역 생성
    btnCreate.onclick = async () => {
        const name = nameInput.value.trim();
        const detail = detailInput.value.trim();

        if (!name || !detail) {
            alert("이름과 설명을 모두 입력하세요.");
            return;
        }

        try {
            const res = await apiFetch("/base/region-create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    originId: origin,
                    name,
                    detail
                })
            });

            const json = await res.json();

            if (!json.ok) {
                alert(json.error || "지역 생성 실패");
                return;
            }

            alert("지역 생성 완료");

            // 🔥 선택 상태 초기화 (중요)
            sessionStorage.removeItem("regionId");
            sessionStorage.removeItem("regionName");

            showPage("create");

        } catch (err) {
            console.error(err);
            alert("서버 요청 중 오류 발생");
        }
    };
}
