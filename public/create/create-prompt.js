import { ORIGINS_FRONT } from "./origins.front.js";
import { apiFetch } from "/base/api.js";

export async function initCreatePromptPage() {
    const $ = (s) => document.querySelector(s);

    /* ==========================
       입력 길이 규칙

       - 이름: 1~15글자(문자 기준)
       - 프롬프트: 20~1000byte(UTF-8)
       - 시작 버튼: 위 조건 만족 시만 활성화
    ========================== */
    const NAME_MIN = 1;
    const NAME_MAX = 15;
    const PROMPT_MIN_BYTES = 20;
    const PROMPT_MAX_BYTES = 1000;

    const encoder = new TextEncoder();
    const charCount = (s) => Array.from(String(s || "")).length;
    const byteCount = (s) => encoder.encode(String(s || "")).length;

    // 1000byte 초과 입력을 즉시 잘라내기(UTF-8 기준)
    function trimToMaxBytes(str, maxBytes) {
        const s = String(str || "");
        if (byteCount(s) <= maxBytes) return s;

        const chars = Array.from(s);
        let lo = 0;
        let hi = chars.length;

        // binary search: 최대 maxBytes를 만족하는 가장 긴 prefix
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
        const lineHeight = parseFloat(cs.lineHeight) || 20;
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const paddingBottom = parseFloat(cs.paddingBottom) || 0;
        const borderTop = parseFloat(cs.borderTopWidth) || 0;
        const borderBottom = parseFloat(cs.borderBottomWidth) || 0;

        const minHeight = lineHeight * 4 + paddingTop + paddingBottom + borderTop + borderBottom;
        const nextHeight = Math.max(el.scrollHeight, minHeight);
        el.style.height = nextHeight + "px";
    }

    function setBtnEnabled(btn, enabled) {
        if (!btn) return;
        btn.disabled = !enabled;

        // 기존 CSS가 있을 수도 있으니, “활성/비활성 느낌”을 위해 class도 같이 토글
        btn.classList.toggle("disabled", !enabled);
    }

    function updateUiValidity({ nameInput, promptInput, btnNext }) {
        const nameTrim = nameInput.value.trim();
        const promptTrim = promptInput.value.trim();

        // 카운터 UI
        const nameLen = charCount(nameTrim);
        const promptBytes = byteCount(promptTrim);

        const $nameCount = $("#nameCount");
        const $promptByteCount = $("#promptByteCount");
        const $nameMax = $("#nameMax");
        const $promptByteMax = $("#promptByteMax");

        if ($nameCount) $nameCount.textContent = String(nameLen);
        if ($promptByteCount) $promptByteCount.textContent = String(promptBytes);
        if ($nameMax) $nameMax.textContent = String(NAME_MAX);
        if ($promptByteMax) $promptByteMax.textContent = String(PROMPT_MAX_BYTES);

        const okName = nameLen >= NAME_MIN && nameLen <= NAME_MAX;
        const okPrompt = promptBytes >= PROMPT_MIN_BYTES && promptBytes <= PROMPT_MAX_BYTES;

        setBtnEnabled(btnNext, okName && okPrompt);
    }

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

    // textarea: 자동 높이 증가 UX
    if (promptInput) {
        promptInput.style.overflow = "hidden";
        promptInput.style.resize = "none";
    }

    // 초기 카운터/버튼 상태
    updateUiValidity({ nameInput, promptInput, btnNext });
    autosizeTextarea(promptInput);

    // 입력 이벤트로 실시간 카운팅 + 버튼 활성화
    let isComposingName = false;
    let isComposingPrompt = false;

    nameInput.addEventListener("compositionstart", () => {
        isComposingName = true;
    });
    nameInput.addEventListener("compositionend", () => {
        isComposingName = false;

        // composition 종료 시 최종 정리
        const chars = Array.from(nameInput.value.trimStart());
        nameInput.value = chars.slice(0, NAME_MAX).join("");
        updateUiValidity({ nameInput, promptInput, btnNext });
    });

    nameInput.addEventListener("input", () => {
        if (isComposingName) return;

        // maxlength=15가 있어도, 붙여넣기 등 edge case 대비
        const trimmed = nameInput.value.trimStart();
        // 이름 앞쪽 공백만 과하게 들어오면 UX가 나빠서, 앞 공백은 정리(뒤 공백은 사용자가 의도했을 수 있으니 trim은 저장시에만)
        if (trimmed !== nameInput.value) nameInput.value = trimmed;

        // JS 기준 글자수(코드포인트) 15 초과 시 잘라내기 (emoji 등도 안정적으로 처리)
        const chars = Array.from(nameInput.value);
        if (chars.length > NAME_MAX) {
            nameInput.value = chars.slice(0, NAME_MAX).join("");
        }

        updateUiValidity({ nameInput, promptInput, btnNext });
    });

    // 프롬프트: 페이지 진입 직후에도 "기본 4줄"을 자연스럽게 유지
    // (폰트/라인하이트 적용 후 실제 높이 계산을 위해 rAF 사용)
    requestAnimationFrame(() => autosizeTextarea(promptInput));

    promptInput.addEventListener("compositionstart", () => {
        isComposingPrompt = true;
    });
    promptInput.addEventListener("compositionend", () => {
        isComposingPrompt = false;

        // composition 종료 시 바이트 컷 + autosize
        const raw = promptInput.value;
        const trimmed = trimToMaxBytes(raw, PROMPT_MAX_BYTES);
        if (trimmed !== raw) promptInput.value = trimmed;
        autosizeTextarea(promptInput);
        updateUiValidity({ nameInput, promptInput, btnNext });
    });

    promptInput.addEventListener("input", () => {
        if (isComposingPrompt) return;

        // 1000byte 초과 방지
        const raw = promptInput.value;
        const trimmed = trimToMaxBytes(raw, PROMPT_MAX_BYTES);
        if (trimmed !== raw) promptInput.value = trimmed;

        autosizeTextarea(promptInput);
        updateUiValidity({ nameInput, promptInput, btnNext });
    });

    btnNext.onclick = async () => {
        window.__startGlobalLoading?.();
        const stopLoading = () => window.__stopGlobalLoading?.();

        // 🔒 서버 세션 존재 여부 확인
        const checkRes = await apiFetch("/create/story-check");
        const check = await checkRes.json();

        if (check.ok && check.flow) {

            if (check.flow === "final") {

                // 🔥 30초 초과 시 재생성 허용
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

            // 🔥 서버에서 자동 삭제되므로 그냥 진행
        }


        // ⬇️ 생성 로직(입력 검증 강화: FE/BE 동일 기준)
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
                window.__stopGlobalLoading?.();

                if (json.error === "INSUFFICIENT_SCROLL") {
                    alert("두루마리가 부족합니다.");
                    return;
                }

                // 입력 검증 관련 에러(서버 기준)
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
            window.__stopGlobalLoading?.();

            // 🔥 userMeta 즉시 반영 (DB 재조회 방지)
            if (json.userMeta) {
                sessionStorage.setItem("userMeta", JSON.stringify(json.userMeta));
                window.__updateChromeResource?.(json.userMeta);
            }

            // 🔥 이동
            window.location.href = "/create/create-story.html";


        } catch (err) {
            console.error(err);
            window.__stopGlobalLoading?.();

            alert("서버 요청 중 오류 발생");
        }
    };
}
