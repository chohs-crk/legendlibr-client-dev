import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";

export async function initCharacterImagePage() {
    /* =========================
       캐릭터 ID (항상 최신)
    ========================= */
    const charId = sessionStorage.getItem("viewCharId");
    if (!charId) {
        alert("잘못된 접근입니다.");
        showPage("home");
        return;
    }

    /* =========================
       DOM
    ========================= */
    const imgEl = document.getElementById("currentImage");
    const grid = document.getElementById("imageGrid");
    const aiSlot = document.getElementById("aiSlot");
    const btnApply = document.getElementById("btnApply");

    const aiOverlay = document.getElementById("aiOverlay");
    const aiPromptInput = document.getElementById("aiPromptInput");
    const btnAICancel = document.getElementById("btnAICancel");
    const btnAIGenerate = document.getElementById("btnAIGenerate");
    const loadingOverlay = document.getElementById("loadingOverlay");

    /* =========================
       상태 초기화 (🔥 중요)
    ========================= */
    let selectedImage = null;
    let aiImages = [];
    let selectedStyle = null;

    imgEl.src = "";
    grid.querySelectorAll(".ai-image-item").forEach(el => el.remove());
    grid.querySelectorAll(".selected").forEach(el => el.classList.remove("selected"));

    /* =========================
       스타일 버튼
    ========================= */
    document.querySelectorAll(".style-btn").forEach(btn => {
        btn.classList.remove("active");
        btn.onclick = () => {
            document.querySelectorAll(".style-btn")
                .forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectedStyle = btn.dataset.style;
        };
    });

    /* =========================
       캐릭터 정보 로드
    ========================= */
    const res = await apiFetch(`/base/characters?id=${encodeURIComponent(charId)}`);
    if (!res.ok) {
        alert("캐릭터 정보를 불러올 수 없습니다.");
        showPage("home");
        return;
    }

    const character = await res.json();

    // 🔥 본인 확인
    if (!character.isMine) {
        alert("권한이 없습니다.");
        showPage("character-view", {
            type: "replace",
            charId
        });
        return;
    }
    selectedImage = character.image;
    aiImages = character.aiImages || [];
    imgEl.src = resolveCharImage(selectedImage);

    renderAIImages();

    /* =========================
       기본 / 프리셋 선택
    ========================= */
    grid.querySelectorAll("img[data-type]").forEach(img => {
        img.onclick = () => {
            clearSelected();
            img.classList.add("selected");

            selectedImage = {
                type: img.dataset.type,
                key: img.dataset.key,
                url: ""
            };
            imgEl.src = resolveCharImage(selectedImage);
        };
    });

    /* =========================
       AI 이미지 렌더
    ========================= */
    function renderAIImages() {
        grid.querySelectorAll(".ai-image-item").forEach(el => el.remove());

        aiImages.forEach(ai => {
            const img = document.createElement("img");
            img.src = ai.url;
            img.className = "ai-image-item";

            img.onclick = () => {
                clearSelected();
                img.classList.add("selected");
                selectedImage = { type: "ai", key: "ai", url: ai.url };
                imgEl.src = ai.url;
            };

            grid.insertBefore(img, aiSlot);
        });
    }

    function clearSelected() {
        grid.querySelectorAll(".selected")
            .forEach(el => el.classList.remove("selected"));
    }

    /* =========================
       AI 모달
    ========================= */
    aiSlot.onclick = () => {
        aiPromptInput.value = "";
        selectedStyle = null;
        btnAIGenerate.disabled = true;
        aiOverlay.style.display = "flex";
    };

    btnAICancel.onclick = () => {
        aiOverlay.style.display = "none";
    };

    aiPromptInput.oninput = () => {
        const len = aiPromptInput.value.trim().length;
        btnAIGenerate.disabled = !(len >= 30 && len <= 200);
    };

    /* =========================
       AI 이미지 생성
    ========================= */
    btnAIGenerate.onclick = async () => {
        loadingOverlay.style.display = "flex";

        try {
            const res = await apiFetch("/base/characters-ai-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: charId,
                    prompt: aiPromptInput.value.trim(),
                    style: selectedStyle
                })
            });

            const data = await res.json();
            if (!data.ok) {
                alert(data.error || "AI 이미지 생성 실패");
                return;
            }
            if (data.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(data.userMeta));

                // 🔥 상단 UI 즉시 반영
                window.__updateChromeResource?.(data.userMeta);
            }

            aiImages.push({ url: data.imageUrl });
            selectedImage = { type: "ai", key: "ai", url: data.imageUrl };
            imgEl.src = data.imageUrl;
            renderAIImages();
            aiOverlay.style.display = "none";

        } finally {
            loadingOverlay.style.display = "none";
        }
    };

    /* =========================
       적용 버튼
    ========================= */
    btnApply.onclick = async () => {
        if (!selectedImage) {
            alert("이미지를 선택하세요.");
            return;
        }

        await apiFetch("/base/image-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: charId,
                image: selectedImage
            })
        });

        /* =========================
           🔥 home 캐시 있으면 image만 갱신
        ========================= */
        const cached = sessionStorage.getItem("homeCharacters");

        if (cached) {
            const arr = JSON.parse(cached);

            const updated = arr.map(c => {
                if (c.id === charId) {
                    return {
                        ...c,
                        image: selectedImage
                    };
                }
                return c;
            });

            sessionStorage.setItem(
                "homeCharacters",
                JSON.stringify(updated)
            );
        }

        sessionStorage.setItem("viewCharId", charId);

        showPage("character-view", {
            type: "push",
            charId: charId
        });


    };

}
