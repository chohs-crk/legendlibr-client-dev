import { ORIGINS_FRONT } from "./origins.front.js";
import { apiFetch } from "/base/api.js";
import { openWrap } from "/base/common/ui-wrap.js";

export async function initCreatePromptPage() {
    const root = document.getElementById("page-create-prompt");
    if (!root) return;

    const firstInit = root.dataset.initialized !== "true";
    if (firstInit) {
        root.dataset.initialized = "true";
    }

    const $ = (selector) => root.querySelector(selector);

    const NAME_MIN = 1;
    const NAME_MAX = 15;
    const PROMPT_MIN_BYTES = 20;
    const PROMPT_MAX_BYTES = 1000;
    const NAME_PLACEHOLDER = "프리무스";
    const PROMPT_PLACEHOLDER = "옛날 옛날 한 천사가 살았다.";

    const encoder = new TextEncoder();
    const charCount = (s) => Array.from(String(s || "")).length;
    const byteCount = (s) => encoder.encode(String(s || "")).length;

    let currentRegionDetail = null;

    function trimToMaxBytes(str, maxBytes) {
        const s = String(str || "");
        if (byteCount(s) <= maxBytes) return s;

        const chars = Array.from(s);
        let lo = 0;
        let hi = chars.length;

        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const candidate = chars.slice(0, mid).join("");
            if (byteCount(candidate) <= maxBytes) lo = mid;
            else hi = mid - 1;
        }

        return chars.slice(0, lo).join("");
    }

    function autosizeTextarea(el) {
        if (!el) return;
        el.style.height = "auto";

        const cs = window.getComputedStyle(el);
        const lineHeight = parseFloat(cs.lineHeight) || 24;
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const paddingBottom = parseFloat(cs.paddingBottom) || 0;
        const borderTop = parseFloat(cs.borderTopWidth) || 0;
        const borderBottom = parseFloat(cs.borderBottomWidth) || 0;

        const minHeight = lineHeight * 4 + paddingTop + paddingBottom + borderTop + borderBottom;
        el.style.height = Math.max(el.scrollHeight, minHeight) + "px";
    }

    function setBtnEnabled(btn, enabled) {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.classList.toggle("disabled", !enabled);
    }

    function getRegionMetaText(detail) {
        if (detail?.source === "user") {
            const ownerName = detail?.ownerchar?.name || "대표 없음";
            const charCountText = Number(detail?.charnum || 0);
            return `${ownerName} · ${charCountText}명의 캐릭터`;
        }
        return detail?.meta || "기본 지역";
    }

    function setPromptCounterState({ okPrompt }) {
        const promptCounter = $("#promptByteCounter") || $("#promptByteCount")?.closest(".field-counter");
        const promptCount = $("#promptByteCount");
        const promptMax = $("#promptByteMax");

        [promptCounter, promptCount, promptMax].forEach((el) => {
            if (!el) return;
            el.classList.toggle("is-invalid", !okPrompt);
            el.classList.toggle("is-valid", okPrompt);
        });
    }

    function updateUiValidity({ nameInput, promptInput, btnNext }) {
        if (!nameInput || !promptInput) return;

        const rawName = String(nameInput.value || "");
        const rawPrompt = String(promptInput.value || "");
        const nameTrim = rawName.trim();
        const promptTrim = rawPrompt.trim();

        const nameLen = charCount(rawName);
        const promptBytes = byteCount(rawPrompt);

        const $nameCount = $("#nameCount");
        const $promptByteCount = $("#promptByteCount");
        const $nameMax = $("#nameMax");
        const $promptByteMax = $("#promptByteMax");

        if ($nameCount) $nameCount.textContent = String(nameLen);
        if ($promptByteCount) $promptByteCount.textContent = String(promptBytes);
        if ($nameMax) $nameMax.textContent = String(NAME_MAX);
        if ($promptByteMax) $promptByteMax.textContent = String(PROMPT_MAX_BYTES);

        const okName = charCount(nameTrim) >= NAME_MIN && charCount(nameTrim) <= NAME_MAX;
        const okPrompt = byteCount(promptTrim) >= PROMPT_MIN_BYTES && byteCount(promptTrim) <= PROMPT_MAX_BYTES;

        setPromptCounterState({ okPrompt });
        setBtnEnabled(btnNext, okName && okPrompt);
    }

    function resetClientStorySession() {
        sessionStorage.removeItem("story_log");
        sessionStorage.removeItem("choices_backup_story1");
        sessionStorage.removeItem("choices_backup_story3");
        sessionStorage.removeItem("aiIntro");
        sessionStorage.removeItem("currentSceneKey");
        sessionStorage.removeItem("displayNameRaw");
    }

    function goCreatePage() {
        if (typeof window.showPage === "function") {
            window.showPage("create", { type: "push" });
            return;
        }
        window.location.href = "/create";
    }

    function escapeHtml(str) {
        return String(str || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function setRegionDetail(detail) {
        const regionNameEl = $("#regionName");
        const normalizedDetail = {
            name: detail?.name || regionNameEl?.textContent || "지역 정보",
            meta: getRegionMetaText(detail),
            detail: detail?.detail || "지역 설명을 불러올 수 없습니다.",
            source: detail?.source || "base",
            ownerchar: detail?.ownerchar,
            charnum: detail?.charnum,
        };

        currentRegionDetail = normalizedDetail;

        const panel = $("#regionDetailPanel");
        const title = $("#regionDetailTitle");
        const meta = $("#regionDetailMeta");
        const desc = $("#regionDetailDesc");

        if (title) title.textContent = normalizedDetail.name;
        if (meta) meta.textContent = normalizedDetail.meta;
        if (desc) desc.innerHTML = escapeHtml(normalizedDetail.detail);
        if (panel) panel.hidden = true;
    }

    function openRegionDetailPopup() {
        if (typeof openWrap !== "function") return;

        const detail = currentRegionDetail || {
            name: $("#regionName")?.textContent || "지역 정보",
            meta: "기본 지역",
            detail: "지역 설명을 불러올 수 없습니다.",
        };

        openWrap(`
            <div class="cp-region-popup">
                <h3 class="cp-region-popup-title">${escapeHtml(detail.name)}</h3>
                <div class="cp-region-popup-meta">${escapeHtml(detail.meta)}</div>
                <div class="text-flow cp-region-popup-desc">${escapeHtml(detail.detail)}</div>
            </div>
        `);
    }

    function bindRegionDetailPopup() {
        const button = $("#regionInfoButton");
        const panel = $("#regionDetailPanel");
        if (!button || button.dataset.bound === "true") return;

        button.dataset.bound = "true";
        button.setAttribute("aria-haspopup", "dialog");
        button.removeAttribute("aria-expanded");
        button.setAttribute("title", "지역 정보 보기");

        const icon = button.querySelector(".region-chip-icon");
        if (icon) {
            icon.textContent = "i";
            icon.setAttribute("aria-hidden", "true");
        }

        if (panel) {
            panel.hidden = true;
            panel.setAttribute("aria-hidden", "true");
        }

        button.addEventListener("click", () => {
            openRegionDetailPopup();
        });
    }

    async function hydrateSelectedRegionDetail(originId, regionId) {
        try {
            const res = await apiFetch("/base/get-regions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ originId }),
            });
            const json = await res.json();

            if (!json?.ok || !Array.isArray(json.regions)) {
                setRegionDetail(null);
                return;
            }

            const target = json.regions.find((r) => String(r.id) === String(regionId));
            setRegionDetail(target || null);
        } catch (error) {
            console.warn("failed to load selected region detail", error);
            setRegionDetail(null);
        }
    }

    const originId = sessionStorage.getItem("origin");
    const regionId = sessionStorage.getItem("regionId");
    const regionName = sessionStorage.getItem("regionName");

    if (!originId || !regionId) {
        alert("기원과 지역을 다시 선택해주세요.");
        goCreatePage();
        throw new Error("invalid create state");
    }

    const originData = ORIGINS_FRONT[originId];
    if (!originData) {
        alert("잘못된 기원 선택입니다.");
        goCreatePage();
        throw new Error("invalid origin");
    }

    const nameInput = $("#nameInput");
    const promptInput = $("#promptInput");
    const btnNext = $("#btnNext");
    const originNameEl = $("#originName");
    const regionNameEl = $("#regionName");

    if (!nameInput || !promptInput || !btnNext || !originNameEl || !regionNameEl) {
        root.dataset.initialized = "false";
        throw new Error("create-prompt DOM not ready");
    }

    originNameEl.textContent = originData.name;
    regionNameEl.textContent = regionName || "알 수 없음";

    nameInput.placeholder = NAME_PLACEHOLDER;
    promptInput.placeholder = PROMPT_PLACEHOLDER;

    nameInput.value = "";
    promptInput.value = "";

    setRegionDetail({
        name: regionName || "알 수 없음",
        meta: "기본 지역",
        detail: "지역 설명을 불러오는 중입니다.",
    });
    bindRegionDetailPopup();
    hydrateSelectedRegionDetail(originId, regionId);

    try {
        const res = await apiFetch("/create/story-check");
        const j = await res.json();

        if (j.ok) {
            if (j.isFinalFF) {
                location.href = "/create/create-final.html";
                return;
            }

            if (j.flow) {
                if (j.flow === "final") {
                    alert("이미 최종 생성 단계에 있는 캐릭터가 있습니다.");
                    return;
                }

                const go = confirm("진행 중인 생성이 있습니다. 해당 단계로 이동하시겠습니까 ? ");
                if (go) {
                    window.location.href = "/create/create-story.html";
                    return;
                }
                return;
            }
        }
    } catch (e) {
        console.warn("story-check failed:", e)

    }

    promptInput.style.overflow = "hidden";
    promptInput.style.resize = "none";

    updateUiValidity({ nameInput, promptInput, btnNext });
    requestAnimationFrame(() => autosizeTextarea(promptInput));

    if (firstInit) {
        let isComposingName = false;
        let isComposingPrompt = false;

        nameInput.addEventListener("compositionstart", () => {
            isComposingName = true;
            updateUiValidity({ nameInput, promptInput, btnNext });
        });

        nameInput.addEventListener("compositionupdate", () => {
            updateUiValidity({ nameInput, promptInput, btnNext });
        });

        nameInput.addEventListener("compositionend", () => {
            isComposingName = false;

            const chars = Array.from(nameInput.value.trimStart());
            nameInput.value = chars.slice(0, NAME_MAX).join("");
            updateUiValidity({ nameInput, promptInput, btnNext });
        });

        nameInput.addEventListener("input", () => {
            const trimmedStart = nameInput.value.trimStart();
            if (!isComposingName && trimmedStart !== nameInput.value) {
                nameInput.value = trimmedStart;
            }

            if (!isComposingName) {
                const chars = Array.from(nameInput.value);
                if (chars.length > NAME_MAX) {
                    nameInput.value = chars.slice(0, NAME_MAX).join("");
                }
            }

            updateUiValidity({ nameInput, promptInput, btnNext });
        });

        promptInput.addEventListener("compositionstart", () => {
            isComposingPrompt = true;
            updateUiValidity({ nameInput, promptInput, btnNext });
        });

        promptInput.addEventListener("compositionupdate", () => {
            updateUiValidity({ nameInput, promptInput, btnNext });
            autosizeTextarea(promptInput);
        });

        promptInput.addEventListener("compositionend", () => {
            isComposingPrompt = false;

            const raw = promptInput.value;
            const trimmed = trimToMaxBytes(raw, PROMPT_MAX_BYTES);
            if (trimmed !== raw) promptInput.value = trimmed;

            autosizeTextarea(promptInput);
            updateUiValidity({ nameInput, promptInput, btnNext });
        });

        promptInput.addEventListener("input", () => {
            if (!isComposingPrompt) {
                const raw = promptInput.value;
                const trimmed = trimToMaxBytes(raw, PROMPT_MAX_BYTES);
                if (trimmed !== raw) promptInput.value = trimmed;
            }

            autosizeTextarea(promptInput);
            updateUiValidity({ nameInput, promptInput, btnNext });
        });
    }

    btnNext.onclick = async () => {
        window.__startGlobalLoading?.();
        const stopLoading = () => window.__stopGlobalLoading?.();

        const checkRes = await apiFetch("/create/story-check");
        const check = await checkRes.json();

        if (check.ok && check.flow) {
            if (check.flow === "final") {
                if (check.canRecreateFinal) {
                    const go = confirm("이전 최종 생성이 중단되었습니다.\n새로 생성하시겠습니까?");
                    if (!go) {
                        stopLoading();
                        return;
                    }
                } else {
                    alert("이미 최종 생성 단계에 있습니다.\n잠시 후 다시 시도해주세요.");
                    stopLoading();
                    return;
                }
            }

            const go = confirm("기존 생성 세션을 초기화하고 새로 시작하시겠습니까?");
            if (!go) {
                stopLoading();
                return;
            }
        }

        const name = nameInput.value.trim();
        const prompt = promptInput.value.trim();

        const nameLen = charCount(name);
        const promptBytes = byteCount(prompt);

        if (nameLen < NAME_MIN || nameLen > NAME_MAX) {
            stopLoading();
            alert(`이름은 ${NAME_MIN}~${NAME_MAX}글자이어야 합니다.`);
            return;
        }

        if (promptBytes < PROMPT_MIN_BYTES || promptBytes > PROMPT_MAX_BYTES) {
            stopLoading();
            alert(`프롬프트는 ${PROMPT_MIN_BYTES}~${PROMPT_MAX_BYTES}byte 이어야 합니다.`);
            return;
        }

        resetClientStorySession();
        sessionStorage.setItem("displayNameRaw", name);

        const payload = {
            originId,
            regionId,
            displayNameRaw: name,
            prompt,
        };

        try {
            const res = await apiFetch("/create/prompt-init", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const json = await res.json();

            if (!json.ok) {
                stopLoading();

                if (json.error === "INSUFFICIENT_SCROLL") {
                    alert("두루마리가 부족합니다.");
                    return;
                }
                if (json.error === "INVALID_NAME_LENGTH") {
                    alert(`이름은 ${NAME_MIN}~${NAME_MAX}글자이어야 합니다.`);
                    return;
                }
                if (json.error === "INVALID_PROMPT_BYTE_LENGTH") {
                    alert(`프롬프트는 ${PROMPT_MIN_BYTES}~${PROMPT_MAX_BYTES}byte 이어야 합니다.`);
                    return;
                }

                alert("서버 응답 오류: " + json.error);
                return;
            }

            stopLoading();

            if (json.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(json.userMeta));
                window.__updateChromeResource?.(json.userMeta);
            }

            window.location.href = "/create/create-story.html";
        } catch (err) {
            console.error(err);
            stopLoading();
            alert("서버 요청 중 오류 발생");
        }
    };
}
