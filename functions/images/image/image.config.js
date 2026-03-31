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
            "premium fantasy game portrait",
            "high key lighting",
            "soft radiant glow",
            "smooth painterly rendering",
            "crisp edges",
            "clean fill colors",
            "limited texture",
            "no film grain",
            "no photographic detail",
            "anime key visual",
            "premium character key art",
            "game illustration"
        ],
        sentence:
            "A polished 2D fantasy character portrait with clean line art, refined cel shading, and luminous glossy highlights. The overall image should strongly read as an elegant premium game illustration with a soft radiant atmosphere and graceful high-key lighting."
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
            "grim gothic fantasy",
            "moody dramatic lighting",
            "deep shadows",
            "high contrast",
            "cold desaturated palette",
            "mysterious atmosphere",
            "ominous magical aura",
            "subtle magical glow",
            "ornate fantasy costume"
        ],
        sentence:
            "A strongly dark-fantasy 2D illustration with clean line art, glossy highlights, deep shadows, and ominous dramatic lighting. The entire image should clearly feel gothic, mystical, and severe rather than neutral or bright."
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
            "airy whimsical mood",
            "gentle gradients",
            "light bloom effect",
            "milky highlights",
            "delicate textures"
        ],
        sentence:
            "A distinctly pastel-toned 2D illustration with soft cel shading, milky glossy highlights, and airy lighting. The whole image should clearly feel dreamy, delicate, bright, and whimsical rather than realistic or heavy."
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
            "magenta cyan rim light",
            "futuristic city glow",
            "high contrast lighting",
            "electric color accents",
            "night city atmosphere",
            "holographic details"
        ],
        sentence:
            "A strongly cyberpunk 2D illustration with sharp cel shading, glossy reflections, neon rim light, and electric futuristic accents. The overall image should clearly feel high-tech, nocturnal, vivid, and holographic."
    },

    // 🔹 일본 애니 (2D + 광택 + 선명한 색)
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
            "large expressive anime eyes",
            "bright lighting",
            "polished anime rendering",
            "anime key visual finish"
        ],
        sentence:
            "A clearly Japanese-anime-inspired 2D illustration with crisp line art, smooth cel shading, expressive eyes, and vibrant glossy color. The overall rendering should strongly read as polished anime key visual art rather than generic illustration."
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
   ✅ together_sdxl 로 들어오는 요청을 FLUX.1 [schnell] 로 처리
========================= */
const IMAGE_MODEL_MAP = {
    gemini: {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        costFrames: 50
    },

    // ✅ SDXL 요청(modelKey=together_sdxl)은 내부에서 FLUX.1 schnell로 실행
    together_sdxl: {
        provider: "together",
        model: "black-forest-labs/FLUX.1-schnell",
        costFrames: 10,

        // FLUX 계열은 negative prompt 미지원인 경우가 많으니 끔
        supportsNegativePrompt: false,

        // Together FLUX.1 schnell 기본 4 steps 사용
        steps: 4
    },

    together_flux2: {
        provider: "together",
        model: "black-forest-labs/FLUX.2-dev",
        costFrames: 25,
        supportsNegativePrompt: false,
        steps: 28
    }
};

const MODEL_PROMPT_POLICY = {
    gemini: {
        openai: {
            tags: { subject: 10, background: 6, composition: 8, style: 10, negative: 8 },
            sentencesPerSection: 1
        },
        final: {
            subject: 10,
            background: 8,
            composition: 12,
            style: 12,
            negative: 8
        }
    },

    together_sdxl: {
        openai: {
            tags: { subject: 12, background: 8, composition: 10, style: 12, negative: 8 },
            sentencesPerSection: 1
        },
        final: {
            subject: 12,
            background: 8,
            composition: 14,
            style: 16,
            negative: 8
        }
    },

    together_flux2: {
        openai: {
            tags: { subject: 14, background: 10, composition: 12, style: 14, negative: 10 },
            sentencesPerSection: 1
        },
        final: {
            subject: 14,
            background: 10,
            composition: 16,
            style: 20,
            negative: 10
        }
    }
};

function getModelPromptPolicy(modelKey) {
    return MODEL_PROMPT_POLICY[modelKey] || MODEL_PROMPT_POLICY.gemini;
}

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

module.exports = {
    STYLE_PRESETS,
    IMAGE_MODEL_MAP,
    MODEL_PROMPT_POLICY,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    normalizeStyleKey,
    normalizePromptFormat,
    resolvePromptFormat,
    getModelPromptPolicy
};
