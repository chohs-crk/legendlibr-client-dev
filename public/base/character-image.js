import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";

/* =========================
   캐릭터 ID
========================= */
const charId =
    sessionStorage.getItem("viewCharId") ||
    new URLSearchParams(location.search).get("id");

if (!charId) {
    alert("잘못된 접근입니다.");
    showPage("home");
    throw new Error("charId missing");
}


/* =========================
   DOM
========================= */
const imgEl = document.getElementById("currentImage");
const grid = document.getElementById("imageGrid");
const aiSlot = document.getElementById("aiSlot");

const aiOverlay = document.getElementById("aiOverlay");
const aiPromptInput = document.getElementById("aiPromptInput");
const btnAICancel = document.getElementById("btnAICancel");
const btnAIGenerate = document.getElementById("btnAIGenerate");

const btnApply = document.getElementById("btnApply");
const loadingOverlay = document.getElementById("loadingOverlay");

/* =========================
   상태
========================= */
let selectedImage = null;
let aiImages = [];
let selectedStyle = null;

/* =========================
   스타일 버튼 (중복 선택 X)
========================= */
document.querySelectorAll(".style-btn").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll(".style-btn")
            .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedStyle = btn.dataset.style;
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
    grid.querySelectorAll(".selected").forEach(el =>
        el.classList.remove("selected")
    );
}

/* =========================
   캐릭터 정보 로드
========================= */
const res = await apiFetch(`/base/characters?id=${encodeURIComponent(charId)}`);


if (!res.ok) {
    alert("캐릭터 정보를 불러올 수 없습니다.");
    history.back();
}

const character = await res.json();
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
   AI 모달
========================= */
aiSlot.onclick = () => {
    aiPromptInput.value = "";
    selectedStyle = null;
    document.querySelectorAll(".style-btn")
        .forEach(b => b.classList.remove("active"));
    btnAIGenerate.disabled = true;
    aiOverlay.style.display = "flex";
};

btnAICancel.onclick = () => {
    aiOverlay.style.display = "none";
};

aiPromptInput.addEventListener("input", () => {
    const len = aiPromptInput.value.trim().length;
    btnAIGenerate.disabled = !(len >= 30 && len <= 200);
});

/* =========================
   AI 이미지 생성
========================= */
btnAIGenerate.onclick = async () => {
    const prompt = aiPromptInput.value.trim();

    loadingOverlay.style.display = "flex";
    btnAIGenerate.disabled = true;
    btnAICancel.disabled = true;

    try {
        const res = await apiFetch("/base/characters-ai-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: charId,
                prompt,
                style: selectedStyle
            })
        });


        const data = await res.json();

        if (!data.ok) {
            alert(data.error || "AI 이미지 생성 실패");
            return;
        }

        /* =========================
           ✅ 1. AI 이미지 반영
        ========================= */
        aiImages.push({ url: data.imageUrl });
        selectedImage = { type: "ai", key: "ai", url: data.imageUrl };
        imgEl.src = data.imageUrl;
        renderAIImages();
        aiOverlay.style.display = "none";

        /* =========================
           ✅ 2. 재화(currency) 갱신
           - 서버에서 이미 차감됨
           - 클라이언트 캐시만 비우고 재요청
        ========================= */
        sessionStorage.removeItem("userMeta");

        // chrome 재초기화 → ensureUserMeta() 재실행
        const chrome = await import("/base/common/chrome.js");
        chrome.initChrome({ mode: "back+resource" });

    } finally {
        /* =========================
           UI 복구 (성공/실패 공통)
        ========================= */
        loadingOverlay.style.display = "none";
        btnAIGenerate.disabled = false;
        btnAICancel.disabled = false;
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


    sessionStorage.setItem("viewCharId", charId);
    showPage("character-view");

};
