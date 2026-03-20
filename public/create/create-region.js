// /create/create-region.js
import { apiFetch } from "/base/api.js";
import { ORIGINS_FRONT } from "./origins.front.js";

const NAME_MIN = 1;
const NAME_MAX = 15;
const DETAIL_MIN_BYTES = 10;
const DETAIL_MAX_BYTES = 500;

function getByteLength(value = "") {
    return new TextEncoder().encode(value).length;
}

function safeShowPage(pageName) {
    if (typeof window.showPage === "function") {
        window.showPage(pageName);
        return;
    }
    console.warn(`[create-region] showPage is not available: ${pageName}`);
}

function getErrorMessage(code) {
    switch (code) {
        case "INVALID_INPUT":
            return "입력값이 올바르지 않습니다.";
        case "INVALID_ORIGIN":
            return "기원 정보가 올바르지 않습니다.";
        case "REGION_LIMIT_EXCEEDED":
            return "지역은 최대 10개까지 만들 수 있습니다.";
        case "REGION_NAME_LENGTH_INVALID":
            return `지역 이름은 ${NAME_MIN}~${NAME_MAX}글자여야 합니다.`;
        case "REGION_DETAIL_LENGTH_INVALID":
            return `지역 설명은 ${DETAIL_MIN_BYTES}~${DETAIL_MAX_BYTES}byte여야 합니다.`;
        case "REGION_NAME_UNSAFE":
            return "지역 이름이 서비스 기준에 맞지 않습니다.";
        case "REGION_DETAIL_UNSAFE":
            return "지역 설명이 서비스 기준에 맞지 않습니다.";
        case "SERVER_ERROR":
            return "서버 처리 중 오류가 발생했습니다.";
        case "AI_CALL_FAILED":
        case "AI_RESPONSE_INVALID":
        case "AI_EMPTY_RESPONSE":
        case "GEMINI_REQUEST_FAILED":
            return "설명을 다듬는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        default:
            return code || "지역 생성에 실패했습니다.";
    }
}

function renderValidationState({
    nameInput,
    detailInput,
    btnNext,
    nameCountEl,
    nameMaxEl,
    detailCountEl,
    detailMaxEl,
    isSubmitting,
}) {
    const name = nameInput.value.trim();
    const detail = detailInput.value.trim();

    const nameLen = name.length;
    const detailBytes = getByteLength(detail);

    const isNameValid = nameLen >= NAME_MIN && nameLen <= NAME_MAX;
    const isDetailValid = detailBytes >= DETAIL_MIN_BYTES && detailBytes <= DETAIL_MAX_BYTES;

    if (nameCountEl) {
        nameCountEl.textContent = String(nameLen);
        nameCountEl.classList.toggle("is-invalid", !isNameValid && nameLen > 0);
    }

    if (nameMaxEl) {
        nameMaxEl.textContent = String(NAME_MAX);
        nameMaxEl.classList.toggle("is-invalid", !isNameValid && nameLen > 0);
    }

    if (detailCountEl) {
        detailCountEl.textContent = String(detailBytes);
        detailCountEl.classList.toggle("is-invalid", !isDetailValid && detail.length > 0);
    }

    if (detailMaxEl) {
        detailMaxEl.textContent = String(DETAIL_MAX_BYTES);
        detailMaxEl.classList.toggle("is-invalid", !isDetailValid && detail.length > 0);
    }

    nameInput.classList.toggle("is-invalid", !!name && !isNameValid);
    detailInput.classList.toggle("is-invalid", !!detail && !isDetailValid);

    btnNext.disabled = isSubmitting || !isNameValid || !isDetailValid;

    return {
        name,
        detail,
        isNameValid,
        isDetailValid,
    };
}

function bindLiveValidation({
    nameInput,
    detailInput,
    btnNext,
    nameCountEl,
    nameMaxEl,
    detailCountEl,
    detailMaxEl,
}) {
    let isSubmitting = false;

    const update = () =>
        renderValidationState({
            nameInput,
            detailInput,
            btnNext,
            nameCountEl,
            nameMaxEl,
            detailCountEl,
            detailMaxEl,
            isSubmitting,
        });

    const setSubmitting = (value) => {
        isSubmitting = value;
        btnNext.classList.toggle("is-loading", value);
        btnNext.textContent = value ? "생성 중..." : "다음";
        nameInput.readOnly = value;
        detailInput.readOnly = value;
        update();
    };

    nameInput.maxLength = NAME_MAX;
    detailInput.maxLength = DETAIL_MAX_BYTES;
    nameInput.placeholder = "예) 패왕굴 북단";
    detailInput.placeholder = "이 지역의 분위기, 전설 등을 적어주세요";

    nameInput.oninput = update;
    detailInput.oninput = update;

    update();

    return {
        update,
        setSubmitting,
    };
}

export function initCreateRegionPage() {
    const $ = (s) => document.querySelector(s);

    const originNameEl = $("#regionOriginName");
    const nameInput = $("#regionNameInput");
    const detailInput = $("#regionDetailInput");
    const btnCancel = $("#btnRegionCancel");
    const btnNext = $("#btnRegionNext");
    const nameCountEl = $("#regionNameCount");
    const nameMaxEl = $("#regionNameMax");
    const detailCountEl = $("#regionDetailCount");
    const detailMaxEl = $("#regionDetailMax");

    if (
        !originNameEl ||
        !nameInput ||
        !detailInput ||
        !btnCancel ||
        !btnNext ||
        !nameCountEl ||
        !nameMaxEl ||
        !detailCountEl ||
        !detailMaxEl
    ) {
        console.warn("[create-region] DOM not ready");
        return;
    }

    nameInput.value = "";
    detailInput.value = "";

    const origin = sessionStorage.getItem("origin");
    if (!origin) {
        alert("기원을 다시 선택해주세요.");
        safeShowPage("create");
        return;
    }

    const originLabel = ORIGINS_FRONT[origin]?.name ?? origin;
    originNameEl.textContent = originLabel;

    const { update, setSubmitting } = bindLiveValidation({
        nameInput,
        detailInput,
        btnNext,
        nameCountEl,
        nameMaxEl,
        detailCountEl,
        detailMaxEl,
    });

    btnCancel.onclick = () => {
        safeShowPage("create");
    };

    btnNext.onclick = async () => {
        const { name, detail, isNameValid, isDetailValid } = update();

        if (!isNameValid) {
            alert(`지역 이름은 ${NAME_MIN}~${NAME_MAX}글자여야 합니다.`);
            nameInput.focus();
            return;
        }

        if (!isDetailValid) {
            alert(`지역 설명은 ${DETAIL_MIN_BYTES}~${DETAIL_MAX_BYTES}byte여야 합니다.`);
            detailInput.focus();
            return;
        }

        setSubmitting(true);

        try {
            const res = await apiFetch("/base/region-create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    originId: origin,
                    name,
                    detail,
                }),
            });

            const json = await res.json();

            if (!json.ok) {
                alert(getErrorMessage(json.error));
                return;
            }

            sessionStorage.removeItem("regionId");
            sessionStorage.removeItem("regionName");
            safeShowPage("create");
        } catch (err) {
            console.error(err);
            alert("서버 요청 중 오류가 발생했습니다.");
        } finally {
            setSubmitting(false);
        }
    };
}
