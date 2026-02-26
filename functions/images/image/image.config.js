"use strict";

/* =========================
   스타일/구도
   - processImageJob.js 에서 분리
========================= */
const STYLE_PRESETS = {
    // 🔹 기본 (2D + 광택 강화)
    default: {
        tags: [
            // 🔥 강제 2D 고정 앵커 (최상단 유지)
            "flat 2D anime illustration",
            "bold outlines",
            "thick clean lineart",
            "cel shading",
            "flat shading",
            "illustrated style",
            "minimal skin texture",
            "no photorealism",
            "no realistic lighting",

            // 기존 스타일 요소 + 보강
            "soft elegant portrait",
            "high key lighting",
            "smooth painterly rendering",
            "crisp edges",
            "clean fill colors",
            "limited texture",
            "no film grain",
            "no photographic detail",
            "anime key visual",
            "game illustration"
        ],
        sentence:
            "2D illustration with clean line art and soft cel shading, glossy highlights on skin and fabric. Soft elegant portrait under high key lighting, ethereal atmosphere, smooth painterly rendering with delicate skin shading and a subtle glow, inspired by renaissance digital art."
    },

    // 🔹 다크 판타지 (2D + 광택 + 어두운 분위기)
    darkfantasy: {
        tags: [
            // 🔥 2D 앵커
            "flat 2D anime illustration",
            "bold outlines",
            "thick clean lineart",
            "cel shading",
            "flat shading",
            "illustrated style",
            "no photorealism",
            "no realistic skin",

            // 분위기
            "dark fantasy",
            "moody dramatic lighting",
            "deep shadows",
            "high contrast",
            "mysterious atmosphere",
            "subtle magical glow",
            "ornate fantasy costume"
        ],
        sentence:
            "2D dark fantasy illustration with clean line art and glossy highlights, moody dramatic lighting and deep shadows. High contrast atmosphere with subtle magical glow and mysterious, ornate fantasy elements."
    },

    // 🔹 파스텔 풍 (2D + 광택 + 부드러운 색감)
    pastel: {
        tags: [
            // 🔥 2D 앵커
            "flat 2D anime illustration",
            "bold outlines",
            "thick clean lineart",
            "cel shading",
            "flat shading",
            "illustrated style",
            "no photorealism",
            "no realistic skin",

            // 분위기
            "pastel color palette",
            "soft lighting",
            "dreamy atmosphere",
            "gentle gradients",
            "light bloom effect",
            "delicate textures"
        ],
        sentence:
            "2D illustration with glossy highlights and soft cel shading, rendered in a pastel color palette. Soft lighting, dreamy atmosphere, gentle gradients and light bloom create a delicate and airy mood."
    },

    // 🔹 사이버펑크 (2D + 광택 + 네온)
    cyberpunk: {
        tags: [
            // 🔥 2D 앵커
            "flat 2D anime illustration",
            "bold outlines",
            "thick clean lineart",
            "cel shading",
            "flat shading",
            "illustrated style",
            "no photorealism",
            "no realistic skin",

            // 분위기
            "cyberpunk aesthetic",
            "neon lights",
            "futuristic city glow",
            "high contrast lighting",
            "electric color accents",
            "holographic details"
        ],
        sentence:
            "2D cyberpunk illustration with sharp cel shading and glossy reflections. Neon lighting, futuristic city glow and electric color accents create a high-contrast, holographic atmosphere."
    },

    // 🔹 일본 애니 (2D + 광택 + 선명한 색)  ✅ 안정화: 다른 preset처럼 2D 앵커 보강
    anime: {
        tags: [
            // 🔥 2D 앵커
            "flat 2D anime illustration",
            "bold outlines",
            "thick clean lineart",
            "cel shading",
            "flat shading",
            "illustrated style",
            "no photorealism",
            "no realistic skin",
            "no realistic lighting",

            // 애니 감성
            "clean crisp lineart",
            "smooth cel shading",
            "glossy highlights",
            "vibrant colors",
            "expressive eyes",
            "bright lighting",
            "polished anime rendering"
        ],
        sentence:
            "Polished 2D anime illustration with crisp line art and smooth cel shading, glossy highlights and vibrant colors. Bright lighting enhances expressive eyes and refined anime rendering."
    }
};

const ALLOWED_STYLE_KEYS = new Set(Object.keys(STYLE_PRESETS));

function normalizeStyleKey(v) {
    const raw = typeof v === "string" ? v.trim() : "";
    if (!raw) return null;

    // "설정 안함"(none) 계열은 모두 null 처리
    const compact = raw.toLowerCase().replace(/\s+/g, "");
    if (
        compact === "none" ||
        compact === "off" ||
        compact === "unset" ||
        compact === "nostyle" ||
        compact === "no_style" ||
        compact === "default" ||
        compact === "없음" ||
        compact === "미설정" ||
        compact === "설정안함"
    ) {
        return null;
    }

    // 스타일 키는 소문자 기준으로 허용
    const s = raw.toLowerCase();
    return ALLOWED_STYLE_KEYS.has(s) ? s : null;
}

/* =========================
   프롬프트 출력 포맷(tags vs sentences)
========================= */
function normalizePromptFormat(v) {
    const raw = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (!raw) return null;

    if (["auto", "default", "provider", "model", "자동", "기본"].includes(raw)) return null;

    if (["tags", "tag", "keyword", "keywords", "kw", "키워드", "태그"].includes(raw)) return "tags";

    if (["sentences", "sentence", "text", "paragraph", "paragraphs", "문장", "문장형", "서술", "서술형"].includes(raw)) {
        return "sentences";
    }

    return null;
}

function resolvePromptFormat(job, modelInfo) {
    const forced =
        normalizePromptFormat(job?.promptFormat) ??
        normalizePromptFormat(job?.promptMode) ??
        normalizePromptFormat(job?.prompt_format);

    if (forced) return forced;
    return modelInfo?.provider === "together" ? "tags" : "sentences";
}

/* =========================
   모델 매핑
========================= */
const IMAGE_MODEL_MAP = {
    gemini: {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        costFrames: 50
    },
    together_sdxl: {
        provider: "together",
        model: "stabilityai/stable-diffusion-xl-base-1.0",
        costFrames: 10,
        supportsNegativePrompt: true,
        steps: 30,
        guidance: 8
    },
    together_flux2: {
        provider: "together",
        model: "black-forest-labs/FLUX.2-dev",
        costFrames: 25,
        supportsNegativePrompt: false,
        steps: 28
    }
};

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

module.exports = {
    STYLE_PRESETS,
    IMAGE_MODEL_MAP,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    normalizeStyleKey,
    normalizePromptFormat,
    resolvePromptFormat
};
