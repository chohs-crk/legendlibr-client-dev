import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";

const MODEL_PRICE_MAP = {
    together_sdxl: 10,
    together_flux2: 25,
    gemini: 50
};
const DEFAULT_AI_MODEL = "together_sdxl";

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
    const aiPromptCount = document.getElementById("aiPromptCount");
    const btnAICancel = document.getElementById("btnAICancel");
    const btnAIGenerate = document.getElementById("btnAIGenerate");

    let selectedImage = null;
    let aiImages = [];
    let selectedStyle = null;
    let selectedModel = DEFAULT_AI_MODEL;
    let isSubmittingGenerate = false;
    let toastTimer = null;

    function updateGenerateButtonPrice() {
        const price = MODEL_PRICE_MAP[selectedModel] || 0;
        btnAIGenerate.textContent = `생성 (${price}원)`;
    }

    function updatePromptState() {
        const rawValue = aiPromptInput?.value || "";
        const rawLength = rawValue.length;
        const trimmedLength = rawValue.trim().length;
        const isValid = trimmedLength >= 20 && rawLength <= 1000;

        if (aiPromptCount) {
            aiPromptCount.textContent = `${rawLength} / 1000`;
            aiPromptCount.classList.toggle("is-valid", isValid);
            aiPromptCount.classList.toggle("is-invalid", !isValid && rawLength > 0);
        }

        btnAIGenerate.disabled = !isValid;
    }

    function openAIOverlay() {
        aiOverlay.style.display = "flex";
        updatePromptState();

        requestAnimationFrame(() => {
            aiPromptInput?.focus({ preventScroll: true });
        });
    }

    function closeAIOverlay() {
        aiOverlay.style.display = "none";
    }

    function setApplyDisabled(disabled) {
        btnApply.disabled = disabled;
        btnApply.classList.toggle("is-disabled", disabled);
    }

    function findAiImageByUrl(url) {
        return aiImages.find((ai) => ai?.url === url) || null;
    }

    function canApplyImage(image = selectedImage) {
        if (!image) return false;
        if (image.type !== "ai") return true;

        const found = findAiImageByUrl(image.url);
        return !!found && found.ready !== false;
    }

    function syncApplyButtonState() {
        setApplyDisabled(!canApplyImage());
    }

    function showJobRequestedToast() {
        let toast = document.getElementById("jobRequestToast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "jobRequestToast";
            toast.className = "job-request-toast";
            document.body.appendChild(toast);
        }

        toast.textContent = "작업 요청됨";
        toast.classList.remove("show");
        void toast.offsetWidth;
        toast.classList.add("show");

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove("show");
        }, 1000);
    }

    function upsertLocalAiImage(nextImage) {
        if (!nextImage?.url) return;

        const index = aiImages.findIndex(
            (ai) =>
                (nextImage.jobId && ai?.jobId === nextImage.jobId) ||
                ai?.url === nextImage.url
        );

        if (index >= 0) {
            aiImages[index] = { ...aiImages[index], ...nextImage };
            return;
        }

        aiImages.push(nextImage);
    }

    function removeLocalAiImage({ jobId, url }) {
        aiImages = aiImages.filter((ai) => {
            const sameJob = jobId && ai?.jobId === jobId;
            const sameUrl = url && ai?.url === url;
            return !(sameJob || sameUrl);
        });
    }

    function markLocalAiImageReady({ jobId, url, result }) {
        const resolvedUrl = url || "";
        const index = aiImages.findIndex(
            (ai) =>
                (jobId && ai?.jobId === jobId) ||
                (resolvedUrl && ai?.url === resolvedUrl)
        );

        const prev = index >= 0 ? aiImages[index] : null;
        const readyImage = {
            ...(prev || {}),
            jobId: prev?.jobId || jobId || null,
            url: resolvedUrl || prev?.url || "",
            ready: true,
            fitScore: Number(result?.fitScore || prev?.fitScore || 0),
            safetyScore: Number(result?.safetyScore || prev?.safetyScore || 0),
            updatedAt: Date.now()
        };

        if (index >= 0) {
            aiImages[index] = readyImage;
            return;
        }

        aiImages.push(readyImage);
    }

    imgEl.src = "";
    grid.querySelectorAll(".ai-image-item").forEach((el) => el.remove());
    grid.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));

    function clearSelected() {
        grid.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
    }

    function renderAIImages() {
        grid.querySelectorAll(".ai-image-item").forEach((el) => el.remove());

        aiImages.forEach((ai) => {
            if (ai?.ready === false) {
                const pending = document.createElement("div");
                pending.className = "ai-image-item ai-image-pending";
                pending.innerHTML = `
                    <div class="ai-image-pending-inner">
                        <div class="ai-image-spinner" aria-hidden="true"></div>
                    </div>
                `;
                grid.insertBefore(pending, aiSlot);
                return;
            }

            const img = document.createElement("img");
            img.src = ai.url;
            img.className = "ai-image-item";

            if (selectedImage?.type === "ai" && selectedImage.url === ai.url) {
                img.classList.add("selected");
            }

            img.onclick = () => {
                clearSelected();
                img.classList.add("selected");
                selectedImage = { type: "ai", key: "ai", url: ai.url };
                imgEl.src = ai.url;
                syncApplyButtonState();
            };

            grid.insertBefore(img, aiSlot);
        });

        syncApplyButtonState();
    }

    // 스타일 버튼
    function setActiveStyleButton(styleKeyOrNull) {
        document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));

        const selector = styleKeyOrNull
            ? `.style-btn[data-style="${styleKeyOrNull}"]`
            : `.style-btn[data-style=""]`;

        const btn = document.querySelector(selector);
        if (btn) btn.classList.add("active");
    }

    document.querySelectorAll(".style-btn").forEach((btn) => {
        btn.onclick = () => {
            document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            selectedStyle = btn.dataset.style || null;

            if (btn.dataset.model) selectedModel = btn.dataset.model;
            updateGenerateButtonPrice();
        };
    });

    // AI 모달 열기
    aiSlot.onclick = () => {
        aiPromptInput.value = "";

        selectedModel = DEFAULT_AI_MODEL;
        selectedStyle = selectedModel === "gemini" ? null : "default";

        setActiveModelButton(selectedModel);
        updateGenerateButtonPrice();
        updateStyleVisibilityByModel();
        setActiveStyleButton(selectedStyle);
        openAIOverlay();
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

            updateStyleVisibilityByModel();
        };
    });

    function updateStyleVisibilityByModel() {
        const geminiOnlyBtns = document.querySelectorAll(".gemini-only");

        if (selectedModel === "gemini") {
            geminiOnlyBtns.forEach((btn) => {
                btn.classList.remove("is-hidden");
            });
            return;
        }

        geminiOnlyBtns.forEach((btn) => {
            btn.classList.add("is-hidden");
        });

        if (!selectedStyle) {
            selectedStyle = "default";
            setActiveStyleButton("default");
        }
    }

    setActiveModelButton(selectedModel);
    updateGenerateButtonPrice();
    updateStyleVisibilityByModel();
    updatePromptState();

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
    aiImages = Array.isArray(character.aiImages) ? character.aiImages : [];
    imgEl.src = resolveCharImage(selectedImage);

    renderAIImages();

    grid.querySelectorAll("img[data-type]").forEach((img) => {
        if (
            selectedImage?.type === img.dataset.type &&
            selectedImage?.key === img.dataset.key
        ) {
            img.classList.add("selected");
        }

        img.onclick = () => {
            clearSelected();
            img.classList.add("selected");

            selectedImage = { type: img.dataset.type, key: img.dataset.key, url: "" };
            imgEl.src = resolveCharImage(selectedImage);
            syncApplyButtonState();
        };
    });

    syncApplyButtonState();

    btnAICancel.onclick = () => {
        closeAIOverlay();
    };

    aiOverlay.onclick = (event) => {
        if (event.target === aiOverlay) {
            closeAIOverlay();
        }
    };

    aiPromptInput.oninput = () => {
        updatePromptState();
    };

    async function pollJob(jobId, { intervalMs = 2500, timeoutMs = 5 * 60 * 1000 } = {}) {
        const started = Date.now();

        while (true) {
            if (Date.now() - started > timeoutMs) {
                return {
                    ok: false,
                    error: { code: "TIMEOUT", message: "생성 시간이 너무 길어요." }
                };
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

            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }

    btnAIGenerate.onclick = async () => {
        if (isSubmittingGenerate) return;
        isSubmittingGenerate = true;
        closeAIOverlay();

        try {
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
                alert(created.message || created.error || "AI 이미지 생성 요청 실패");
                return;
            }

            if (created.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(created.userMeta));
                window.__updateChromeResource?.(created.userMeta);
            }

            const pendingImage = created.pendingImage || {
                jobId: created.jobId,
                url: created.imageUrl,
                ready: false
            };

            showJobRequestedToast();
            upsertLocalAiImage(pendingImage);
            renderAIImages();

            const done = await pollJob(created.jobId);

            if (!done.ok) {
                const msg = done?.error?.message || done?.error || "생성 실패";
                alert(msg);
                return;
            }

            if (done.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(done.userMeta));
                window.__updateChromeResource?.(done.userMeta);
            }

            if (done.status === "error") {
                removeLocalAiImage({
                    jobId: created.jobId,
                    url: created.imageUrl
                });
                renderAIImages();

                const msg = done?.error?.message || done?.error?.code || "AI 이미지 생성 실패";
                alert(msg);
                return;
            }

            markLocalAiImageReady({
                jobId: created.jobId,
                url: done.imageUrl || created.imageUrl,
                result: done.result
            });
            renderAIImages();
        } catch (err) {
            console.error("AI_IMAGE_REQUEST_FAILED:", err);
            alert(err?.message || "AI 이미지 생성 요청 실패");
        } finally {
            isSubmittingGenerate = false;
        }
    };

    btnApply.onclick = async () => {
        if (!selectedImage) {
            alert("이미지를 선택하세요.");
            return;
        }

        if (!canApplyImage(selectedImage)) {
            alert("아직 생성 중인 이미지는 적용할 수 없습니다.");
            return;
        }

        const saveRes = await apiFetch("/base/image-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: charId,
                image: selectedImage
            })
        });

        const saveData = await saveRes.json();
        if (!saveData.ok) {
            alert(saveData.message || saveData.error || "이미지 저장 실패");
            return;
        }

        const cacheImage = selectedImage.type === "ai"
            ? {
                type: "ai",
                key: "ai",
                url: selectedImage.url,
                fitScore: Number(findAiImageByUrl(selectedImage.url)?.fitScore || 0)
            }
            : selectedImage;

        const cached = sessionStorage.getItem("homeCharacters");
        if (cached) {
            const arr = JSON.parse(cached);
            const updated = arr.map((c) => (c.id === charId ? { ...c, image: cacheImage } : c));
            sessionStorage.setItem("homeCharacters", JSON.stringify(updated));
        }

        sessionStorage.setItem("viewCharId", charId);

        showPage("character-view", {
            type: "push",
            charId
        });
    };
}
