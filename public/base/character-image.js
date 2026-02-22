import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";

const MODEL_PRICE_MAP = {
    together_flux1_schnell: 10,
    together_flux2: 25,
    gemini: 50
};
const DEFAULT_AI_MODEL = "together_flux1_schnell";

export async function initCharacterImagePage() {
    const charId = sessionStorage.getItem("viewCharId");
    if (!charId) {
        alert("잘못된 접근입니다.");
        showPage("home");
        return;
    }

    const imgEl = document.getElementById("currentImage");
    const grid = document.getElementById("imageGrid");
    const aiSlot = document.getElementById("aiSlot");
    const btnApply = document.getElementById("btnApply");

    const aiOverlay = document.getElementById("aiOverlay");
    const aiPromptInput = document.getElementById("aiPromptInput");
    const btnAICancel = document.getElementById("btnAICancel");
    const btnAIGenerate = document.getElementById("btnAIGenerate");
    const loadingOverlay = document.getElementById("loadingOverlay");

    let selectedImage = null;
    let aiImages = [];
    let selectedStyle = null;
    let selectedModel = DEFAULT_AI_MODEL;

    function updateGenerateButtonPrice() {
        const price = MODEL_PRICE_MAP[selectedModel] || 0;
        btnAIGenerate.textContent = `생성 (${price}원)`;
    }

    imgEl.src = "";
    grid.querySelectorAll(".ai-image-item").forEach((el) => el.remove());
    grid.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));

    // 스타일 버튼
    function setActiveStyleButton(styleKeyOrNull) {
        document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));

        const selector = styleKeyOrNull
            ? `.style-btn[data-style="${styleKeyOrNull}"]`
            : `.style-btn[data-style=""]`; // 설정 안함 버튼

        const btn = document.querySelector(selector);
        if (btn) btn.classList.add("active");
    }

    document.querySelectorAll(".style-btn").forEach((btn) => {
        btn.onclick = () => {
            document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            // ✅ ""(설정 안함) → null
            selectedStyle = btn.dataset.style || null;

            if (btn.dataset.model) selectedModel = btn.dataset.model;
            updateGenerateButtonPrice();
        };
    });

    // AI 모달 열기
    aiSlot.onclick = () => {
        aiPromptInput.value = "";

        selectedStyle = null;
        setActiveStyleButton(null); // ✅ 기본값: 설정 안함(=AI style)

        selectedModel = DEFAULT_AI_MODEL;
        document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
        setActiveStyleButton(null);

        setActiveModelButton(selectedModel);
        updateGenerateButtonPrice();

        btnAIGenerate.disabled = true;
        aiOverlay.style.display = "flex";
    };

    // 모델 버튼
    function setActiveModelButton(modelValue) {
        document.querySelectorAll(".model-btn").forEach((b) => b.classList.remove("active"));
        const btn = document.querySelector(`.model-btn[data-model="${modelValue}"]`);
        if (btn) btn.classList.add("active");
    }

    document.querySelectorAll(".model-btn").forEach((btn) => {
        btn.classList.remove("active");
        btn.onclick = () => {
            document.querySelectorAll(".model-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            selectedModel = btn.dataset.model || DEFAULT_AI_MODEL;
            updateGenerateButtonPrice();
        };
    });

    setActiveModelButton(selectedModel);
    updateGenerateButtonPrice();

    // 캐릭터 로드
    const res = await apiFetch(`/base/characters?id=${encodeURIComponent(charId)}`);
    if (!res.ok) {
        alert("캐릭터 정보를 불러올 수 없습니다.");
        showPage("home");
        return;
    }

    const character = await res.json();

    if (!character.isMine) {
        alert("권한이 없습니다.");
        showPage("character-view", { type: "replace", charId });
        return;
    }

    selectedImage = character.image;
    aiImages = character.aiImages || [];
    imgEl.src = resolveCharImage(selectedImage);

    function renderAIImages() {
        grid.querySelectorAll(".ai-image-item").forEach((el) => el.remove());

        aiImages.forEach((ai) => {
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
        grid.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
    }

    renderAIImages();

    // 기본/프리셋 클릭
    grid.querySelectorAll("img[data-type]").forEach((img) => {
        img.onclick = () => {
            clearSelected();
            img.classList.add("selected");

            selectedImage = { type: img.dataset.type, key: img.dataset.key, url: "" };
            imgEl.src = resolveCharImage(selectedImage);
        };
    });

    // AI 모달 열기
    aiSlot.onclick = () => {
        aiPromptInput.value = "";
        selectedStyle = null;

        selectedModel = DEFAULT_AI_MODEL;
        document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
        setActiveModelButton(selectedModel);
        updateGenerateButtonPrice();

        btnAIGenerate.disabled = true;
        aiOverlay.style.display = "flex";
    };

    btnAICancel.onclick = () => {
        aiOverlay.style.display = "none";
    };

    aiPromptInput.oninput = () => {
        const len = aiPromptInput.value.trim().length;
        btnAIGenerate.disabled = !(len >= 20 && len <= 1000);
    };

    // 폴링 유틸
    async function pollJob(jobId, { intervalMs = 2500, timeoutMs = 5 * 60 * 1000 } = {}) {
        const started = Date.now();

        while (true) {
            if (Date.now() - started > timeoutMs) {
                return { ok: false, error: { code: "TIMEOUT", message: "생성 시간이 너무 길어요." } };
            }

            const res = await apiFetch(`/base/image-job-status?id=${encodeURIComponent(jobId)}`);
            const data = await res.json();

            if (!data.ok) {
                return data;
            }

            if (data.status === "done") {
                return data;
            }

            if (data.status === "error") {
                return data;
            }

            // queued/processing이면 대기
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }

    // AI 생성(비동기 Job)
    btnAIGenerate.onclick = async () => {
        loadingOverlay.style.display = "flex";

        try {
            // 1) job 생성
            const res = await apiFetch("/base/characters-ai-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: charId,
                    prompt: aiPromptInput.value.trim(),
                    style: selectedStyle,
                    model: selectedModel
                })
            });

            const created = await res.json();
            if (!created.ok) {
                alert(created.error || "AI 이미지 생성 요청 실패");
                return;
            }

            // 선불 차감 결과(userMeta) 즉시 반영
            if (created.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(created.userMeta));
                window.__updateChromeResource?.(created.userMeta);
            }

            const jobId = created.jobId;

            // 2) 폴링
            const done = await pollJob(jobId);

            if (!done.ok) {
                alert(done.error || "생성 실패");
                return;
            }

            if (done.status === "error") {
                // (환불이 polling에서 처리된 경우 userMeta가 올 수 있음)
                if (done.userMeta) {
                    sessionStorage.setItem("userMeta", JSON.stringify(done.userMeta));
                    window.__updateChromeResource?.(done.userMeta);
                }

                const msg = done?.error?.message || done?.error?.code || "AI 이미지 생성 실패";
                alert(msg);
                return;
            }

            // done
            const imageUrl = done.imageUrl;

            aiImages.push({ url: imageUrl });
            selectedImage = { type: "ai", key: "ai", url: imageUrl };
            imgEl.src = imageUrl;

            renderAIImages();
            aiOverlay.style.display = "none";

        } finally {
            loadingOverlay.style.display = "none";
        }
    };

    // 적용 버튼
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

        const cached = sessionStorage.getItem("homeCharacters");
        if (cached) {
            const arr = JSON.parse(cached);
            const updated = arr.map((c) => (c.id === charId ? { ...c, image: selectedImage } : c));
            sessionStorage.setItem("homeCharacters", JSON.stringify(updated));
        }

        sessionStorage.setItem("viewCharId", charId);

        showPage("character-view", {
            type: "push",
            charId: charId
        });
    };
}