const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { randomUUID } = require("crypto");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const firestore = admin.firestore();

/* =========================
   Secrets (너가 만든 이름 그대로)
========================= */
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const OPENAI_KEY = defineSecret("OPENAI_KEY");
const TOGETHER_KEY = defineSecret("TOGETHER_KEY");

/* =========================
   스타일/구도
========================= */
const STYLE_PRESETS = {
    // 🔹 기본 (2D + 광택 강화)
    default: {
        tags: [
            "2D illustration",
            "clean lineart",
            "soft cel shading",
            "glossy highlights",
            "soft elegant portrait",
            "high key lighting",
            "luxury white dress",
            "ethereal atmosphere",
            "smooth painterly rendering",
            "delicate skin shading",
            "subtle glow",
            "renaissance inspired digital art"
        ],
        sentence:
            "2D illustration with clean line art and soft cel shading, glossy highlights on skin and fabric. Soft elegant portrait under high key lighting, ethereal atmosphere, smooth painterly rendering with delicate skin shading and a subtle glow, inspired by renaissance digital art."
    },

    // 🔹 다크 판타지 (2D + 광택 + 어두운 분위기)
    darkfantasy: {
        tags: [
            "2D illustration",
            "clean lineart",
            "soft cel shading",
            "glossy highlights",
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
            "2D illustration",
            "clean lineart",
            "soft cel shading",
            "glossy highlights",
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
            "2D illustration",
            "clean lineart",
            "sharp cel shading",
            "glossy reflections",
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

    // 🔹 일본 애니 (2D + 광택 + 선명한 색)
    anime: {
        tags: [
            "2D anime style",
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

/* =========================
   SDXL 전용: LoRA로 "스타일" 주입
   - SDXL은 프롬프트로 그림체(스타일)를 강제하기가 불안정한 경우가 많아서,
     STYLE_PRESETS를 프롬프트에 덮어쓰지 않고 LoRA(image_loras)로만 스타일을 입힙니다.
   - Together Images API: body.image_loras = [{ path, scale }, ...]
========================= */

// SDXL에서 최소한의 2D/광택 힌트는 프롬프트에 공통으로 넣고(과도한 스타일 문구는 제거),
// 스타일 차이는 image_loras로만 주입합니다.
const SDXL_BASE_STYLE_TAGS = [
    "2D illustration",
    "clean lineart",
    "cel shading",
    "glossy highlights"
];

// ✅ 아래 path는 "SDXL용 LoRA(.safetensors) 링크(또는 HF/Replicate/Civitai 모델 URL)"로 교체해야 합니다.
//    - LoRA 개수 제한은 모델/엔드포인트 정책에 따라 달라질 수 있으니 우선 2개 이내를 추천합니다.
//    - job 문서에 imageLoras(또는 image_loras) 배열을 넣으면, preset 대신 그 값을 우선 사용합니다.
const SDXL_LORA_PRESETS = {
    // 공통(base) LoRA: 2D+광택을 강하게 고정
    // - cel-shaded: 셀셰이딩(2D 느낌) 강화
    // - shiny: 광택/하이라이트 강화
    base: [
        {
            path: "https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cel-shaded/resolve/main/cel-shaded.safetensors",
            scale: 1.05
        },
        {
            path: "https://huggingface.co/ntc-ai/SDXL-LoRA-slider.shiny/resolve/main/shiny.safetensors",
            scale: 0.85
        }
    ],

    // 스타일 키별 추가 LoRA (선택)
    default: [],
    darkfantasy: [
        {
            path: "https://huggingface.co/thwri/dark-gothic-fantasy-xl/resolve/main/dark_gothic_fantasy_xl_3.01.safetensors",
            scale: 0.85
        }
    ],
    pastel: [
        {
            path: "https://huggingface.co/Linaqruf/pastel-style-xl-lora/resolve/main/pastel-style-xl-v2.safetensors",
            scale: 0.75
        }
    ],
    cyberpunk: [
        {
            path: "https://huggingface.co/issaccyj/lora-sdxl-cyberpunk/resolve/main/pytorch_lora_weights.safetensors",
            scale: 0.85
        }
    ],
    anime: [
        {
            path: "https://huggingface.co/Linaqruf/pastel-anime-xl-lora/resolve/main/pastel-anime-xl.safetensors",
            scale: 0.9
        }
    ]
};

// 일부 LoRA는 "트리거 토큰"이 있을 때 효과가 더 잘 드러납니다.
// SDXL에서는 '스타일 문장'을 길게 넣지 않고, 트리거만 최소로 추가합니다.
const SDXL_STYLE_TRIGGER_TAGS = {
    // NTC sliders
    base: ["cel-shaded", "shiny"],

    // thwri dark gothic fantasy
    darkfantasy: ["dark gothic fantasy"],

    // issaccyj cyberpunk
    cyberpunk: ["szn style"],

    // Linaqruf 계열은 특정 트리거가 필수는 아닌 편이지만,
    // anime/pastel은 단정한 톤을 위해 가벼운 힌트만 둡니다.
    pastel: [],
    anime: []
};

function normalizeImageLoras(v) {
    if (!Array.isArray(v)) return [];
    return v
        .map((x) => {
            const path = typeof x?.path === "string" ? x.path.trim() : "";
            const scaleRaw = x?.scale;
            const scale = typeof scaleRaw === "number" ? scaleRaw : Number(scaleRaw);
            if (!path) return null;
            if (!Number.isFinite(scale)) return { path, scale: 1.0 };
            return { path, scale };
        })
        .filter(Boolean);
}

function resolveSdxlStyleKey(jobStyle) {
    // job.style이 없거나 비어있으면 default로 간주(기본 룩 유지)
    if (jobStyle == null) return "default";
    const raw = typeof jobStyle === "string" ? jobStyle.trim() : "";
    if (!raw) return "default";
    return normalizeStyleKey(jobStyle); // null이면(설정안함/잘못된 키) LoRA 미적용
}

function resolveSdxlImageLoras(job, styleKey) {
    // (1) job에서 직접 LoRA를 주입하면 최우선 사용 (클라이언트에서 실험/AB에 유리)
    //     - job.imageLoras: [{path, scale}]
    //     - job.image_loras: [{path, scale}]  (snake_case도 허용)
    const fromJob = normalizeImageLoras(job?.imageLoras ?? job?.image_loras);
    if (fromJob.length > 0) return fromJob.slice(0, 3);

    // (2) preset 기반 (코드에 고정된 매핑)
    if (!styleKey) return []; // 명시적으로 none/off/unset이면 미적용
    const base = normalizeImageLoras(SDXL_LORA_PRESETS.base);
    const specific = normalizeImageLoras(SDXL_LORA_PRESETS[styleKey] ?? SDXL_LORA_PRESETS.default);

    // ⚠️ Together 정책/모델에 따라 LoRA 개수 제한이 있을 수 있으니 우선 3개로 제한
    return [...base, ...specific].slice(0, 3);
}

function isSdxlModel(modelId) {
    return typeof modelId === "string" && modelId.toLowerCase().includes("stable-diffusion-xl");
}

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
   - "요청(job) / 모델(provider)"에 따라 OpenAI 1차 정규화 단계에서
     아예 한쪽만 생성하도록 분기하기 위한 유틸
========================= */
function normalizePromptFormat(v) {
    const raw = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (!raw) return null;

    // auto/default 계열은 null → provider 기준 자동 결정
    if (["auto", "default", "provider", "model", "자동", "기본"].includes(raw)) return null;

    // tags/keywords 계열
    if (["tags", "tag", "keyword", "keywords", "kw", "키워드", "태그"].includes(raw)) return "tags";

    // sentences/text 계열
    if (
        ["sentences", "sentence", "text", "paragraph", "paragraphs", "문장", "문장형", "서술", "서술형"].includes(raw)
    ) {
        return "sentences";
    }

    return null;
}

function resolvePromptFormat(job, modelInfo) {
    // (1) job에서 명시적으로 포맷을 강제할 수 있도록 지원
    //     - job.promptFormat / job.promptMode 등 어떤 이름이든 안전하게 흡수
    const forced =
        normalizePromptFormat(job?.promptFormat) ??
        normalizePromptFormat(job?.promptMode) ??
        normalizePromptFormat(job?.prompt_format);

    if (forced) return forced;

    // (2) 기본: provider 기준 자동
    //     - together: 태그(키워드) 기반 모델에 최적
    //     - gemini: 문장(단락) 기반 모델에 최적
    return modelInfo?.provider === "together" ? "tags" : "sentences";
}


const CHARACTER_FOCUS_PROMPT = `
Single character portrait
Upper body or bust composition
Face and expression centered
Chest-up close shot
Lighting focuses on eyes and facial details
Background is simple and slightly blurred
Protagonist framing
`;

/* =========================
   모델 매핑
========================= */
const IMAGE_MODEL_MAP = {
    gemini: {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        costFrames: 50
    },
    together_sdxl: { // 🔥 키 변경
        provider: "together",
        model: "stabilityai/stable-diffusion-xl-base-1.0",
        costFrames: 10,
        supportsNegativePrompt: true,
        steps: 30,
        guidance: 6
    },
    together_flux2: {
        provider: "together",
        // ✅ 교체: Flux 1 dev → Flux 2 dev
        model: "black-forest-labs/FLUX.2-dev",
        costFrames: 25,
        supportsNegativePrompt: false,
        steps: 28
    }
};

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

/* =========================
   utils
========================= */
function stripJsonFence(s) {
    return (s || "")
        .replace(/```json|```/g, "")
        .trim();
}

async function markError(jobRef, jobData, code, message, extra = {}) {
    const now = Date.now();
    const refundSuggested = code !== "SAFETY_BLOCKED"; // 정책: 안전차단은 환불 X
    const refundFrames =
        Number(jobData?.billing?.refund?.frames || jobData?.costFrames || 0);

    await jobRef.update({
        status: "error",
        updatedAt: now,
        finishedAt: now,
        error: { code, message },
        result: jobData?.result || null,

        // refund는 "suggested"만 찍고 실제 적용은 Vercel polling에서(또는 별도 트리거에서)
        "billing.refund.suggested": refundSuggested,
        "billing.refund.frames": refundFrames,

        ...extra
    });
}

/* =========================
   OpenAI: 프롬프트+점수 생성
   - 기존과 같은 Chat Completions 방식 유지(필요하면 Responses로 변경 가능)
========================= */
async function buildImagePromptAndScore(input, openaiKey, options = {}) {
    // ✅ 1차 정규화 단계에서 "tags" 또는 "sentences" 중 하나만 생성하도록 강제
    //    - options.format: "tags" | "sentences"
    const format = options?.format === "tags" ? "tags" : "sentences";

    const outputRules =
        format === "tags"
            ? `
[Output formats]
You MUST output ONLY:
- tags: Flux-style prompting (short phrases, NOT full sentences)
  - Each tag is 1~5 words, English only
  - No commas inside a tag
  - Keep tag lists compact (8~25 tags per section)

Do NOT output any "sentence" fields anywhere in the JSON.
`
            : `
[Output formats]
You MUST output ONLY:
- sentence: sentence-style prompting (English sentences)
  - 1~3 sentences per section
  - Keep it concise and visual

Do NOT output any "tags" fields anywhere in the JSON.
`;

    const outputSchema =
        format === "tags"
            ? `
{
  "subjectType": "human|animal|creature|object|abstract|environment",
  "sections": {
    "subject": { "tags": ["..."] },
    "background": { "tags": ["..."] },
    "composition": { "tags": ["..."] },
    "style": { "tags": ["..."] }
  },
  "negative": { "tags": ["..."] },
  "fitScore": 0,
  "safetyScore": 0
}
`
            : `
{
  "subjectType": "human|animal|creature|object|abstract|environment",
  "sections": {
    "subject": { "sentence": "..." },
    "background": { "sentence": "..." },
    "composition": { "sentence": "..." },
    "style": { "sentence": "..." }
  },
  "negative": { "sentence": "..." },
  "fitScore": 0,
  "safetyScore": 0
}
`;

    const systemPrompt = `
You are a professional image prompt engineer.

[Input]
You will receive a JSON object with:
- promptRefined (string)
- fullStory (string, optional)
- userPrompt (string)
- styleKey (string|null)  // user-selected preset key or null
- modelKey (string)       // for context only

[FitScore Evaluation]
You must evaluate how well the userPrompt visually and thematically fits with:
1) promptRefined (core character concept)
2) fullStory (character background, tone, world context)

FitScore definition:
- 90~100: Extremely well aligned. Strong thematic, visual, and narrative consistency.
- 70~89: Mostly aligned. Minor tone differences but acceptable.
- 40~69: Partially aligned. Noticeable mismatch in tone, style, or concept.
- 1~39: Poorly aligned. Contradicts character identity or world setting.

Important:
- Evaluate thematic consistency.
- Evaluate visual consistency.
- Penalize contradiction.
- Score must be between 1 and 100.

[Safety]
- Do not generate sexual content involving minors.
- Avoid explicit sexual content, extreme gore, hate, or illegal content.
- If user requests disallowed content, set safetyScore high (0~100).

[SafetyScore Evaluation]
You must assign a safetyScore between 0 and 100.
SafetyScore definition (Higher = More Dangerous):

0–10: Completely safe.
11–25: Mild aesthetic attractiveness only.
26–40: Noticeable physical emphasis; light sensual undertone.
41–60: Clear sexual suggestiveness.
61–80: Strong sexualization.
81–100: Explicit sexual content, sexual acts, minors, extreme fetish, illegal content. Must be blocked.

Scoring Rules:
- Be conservative. If unsure, score higher.
- If any minor possibility exists → 90+.
- If safetyScore > 90, it must be blocked.

[Goal]
Create image prompts where the MAIN SUBJECT is always the visual focus.
The subject can be human, animal, creature, object, abstract concept, or environment.
Do NOT force a human if the request is not about a person.
${outputRules}
[Sections]
You MUST produce these sections:
- subject (main subject description)
- background (supporting scene, never overpower the subject)
- composition (camera, framing, focus, perspective)
- style (rendering style suggestion; even if styleKey exists, still generate an AI style suggestion)

[Strict Rules]
- Output MUST be English
- JSON only (no markdown, no extra text)

Return JSON with this exact shape:
${outputSchema}
`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            temperature: 0.25,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(input) }
            ]
        })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.error?.message || "OPENAI_PROMPT_FAILED");
    }

    const text = stripJsonFence(json?.choices?.[0]?.message?.content);
    if (!text) throw new Error("OPENAI_EMPTY_RESPONSE");

    return JSON.parse(text);
}

/* =========================
   Gemini 이미지 생성
========================= */
async function generateImageWithGemini(prompt, geminiKey) {
    const MODEL_ID = "gemini-2.5-flash-image";
    const API_VERSION = "v1beta";

    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": geminiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ["IMAGE"] }
            })
        }
    );

    const json = await res.json().catch(() => ({}));
    if (json.error) {
        throw new Error(`GEMINI_API_ERROR: ${json.error.message}`);
    }

    const part = json?.candidates?.[0]?.content?.parts?.find(
        (p) => p?.inlineData?.data
    );

    if (!part) {
        throw new Error("GEMINI_IMAGE_FAILED: No image data returned.");
    }

    return Buffer.from(part.inlineData.data, "base64");
}

/* =========================
   Together 이미지 생성
   - docs: /images/generations + response_format=base64 → data[0].b64_json :contentReference[oaicite:6]{index=6}
========================= */
async function generateImageWithTogether(
    { model, prompt, width, height, steps, guidance, negativePrompt, seed, imageLoras },
    togetherKey
) {
    const body = {
        model,
        prompt,
        width: width ?? DEFAULT_WIDTH,
        height: height ?? DEFAULT_HEIGHT,
        response_format: "base64",
        output_format: "png",
        n: 1
    };

    if (typeof steps === "number") body.steps = steps;
    if (typeof guidance === "number") body.guidance_scale = guidance;
    if (typeof seed === "number") body.seed = seed;

    if (negativePrompt && typeof negativePrompt === "string") {
        body.negative_prompt = negativePrompt;
    }

    if (Array.isArray(imageLoras) && imageLoras.length > 0) {
        body.image_loras = imageLoras;
    }

    const res = await fetch("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${togetherKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.error?.message || json?.message || "TOGETHER_IMAGE_FAILED");
    }

    const b64 = json?.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, "base64");

    const url = json?.data?.[0]?.url;
    if (url) {
        const imgRes = await fetch(url);
        if (!imgRes.ok) throw new Error("TOGETHER_IMAGE_URL_FETCH_FAILED");
        const arr = await imgRes.arrayBuffer();
        return Buffer.from(arr);
    }

    throw new Error("TOGETHER_IMAGE_FAILED: No image data returned.");
}

/* =========================
   Firestore Trigger
========================= */
exports.processImageJob = onDocumentCreated(
    {
        document: "imageJobs/{jobId}",
        timeoutSeconds: 540,
        memory: "1GiB",
        secrets: [GEMINI_API_KEY, OPENAI_KEY, TOGETHER_KEY]
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const jobRef = snap.ref;
        const job = snap.data() || {};
        const jobId = event.params.jobId;

        // 0) Idempotent lock: queued → processing 만 1회 허용
        try {
            const locked = await firestore.runTransaction(async (tx) => {
                const cur = await tx.get(jobRef);
                if (!cur.exists) return false;
                const curData = cur.data();
                if (curData.status !== "queued") return false;

                tx.update(jobRef, {
                    status: "processing",
                    startedAt: Date.now(),
                    updatedAt: Date.now()
                });
                return true;
            });

            if (!locked) return; // 이미 처리중/완료/에러면 종료
        } catch (e) {
            logger.error("JOB_LOCK_FAILED", jobId, e);
            return;
        }

        const now = Date.now();

        try {
            const uid = job.uid;
            const charId = job.charId;

            if (!uid || !charId) {
                await markError(jobRef, job, "INVALID_JOB", "Missing uid/charId");
                return;
            }

            // 1) 캐릭터 읽기
            const charRef = firestore.collection("characters").doc(charId);
            const charSnap = await charRef.get();

            if (!charSnap.exists) {
                await markError(jobRef, job, "CHAR_NOT_FOUND", "Character doc missing");
                return;
            }

            const char = charSnap.data() || {};
            if (char.uid !== uid) {
                await markError(jobRef, job, "NOT_OWNER", "Character owner mismatch");
                return;
            }
            // 2) 모델 선택 (OpenAI 1차 정규화 포맷을 결정하기 위해 먼저 선택)
            const modelKey = (job.modelKey || "gemini").toString();
            const modelInfo = IMAGE_MODEL_MAP[modelKey];
            if (!modelInfo) {
                await markError(jobRef, job, "INVALID_MODEL", "Unknown modelKey");
                return;
            }

            // 3) OpenAI로 prompt 구성 + score (필요한 포맷만 생성)
            const desiredPromptFormat = resolvePromptFormat(job, modelInfo); // "tags" | "sentences"
            const openaiKey = OPENAI_KEY.value();
            const promptResult = await buildImagePromptAndScore(
                {
                    promptRefined: char.promptRefined,
                    fullStory: char.fullStory ?? char.finalStory,
                    userPrompt: job.userPrompt,

                    // ✅ 프롬프트 엔지니어링 컨텍스트(시스템 프롬프트에 이미 정의됨)
                    styleKey: normalizeStyleKey(job.style),
                    modelKey
                },
                openaiKey,
                { format: desiredPromptFormat }
            );

            // safety 차단
            if (Number(promptResult.safetyScore || 0) > 90) {
                await jobRef.update({
                    updatedAt: Date.now(),
                    result: {
                        fitScore: promptResult.fitScore,
                        safetyScore: promptResult.safetyScore,
                        provider: null,
                        model: null
                    }
                });

                await markError(
                    jobRef,
                    job,
                    "SAFETY_BLOCKED",
                    "Prompt blocked by safety policy"
                );
                return;
            }

            function asTags(v) {
                return Array.isArray(v) ? v.map(x => String(x || "").trim()).filter(Boolean) : [];
            }
            function asSentence(v) {
                return typeof v === "string" ? v.trim() : "";
            }
            function joinTags(list) {
                return list.map(s => s.trim()).filter(Boolean).join(", ");
            }

            function buildFinalPrompt({ promptResult, format, jobStyleKey, userPrompt, modelInfo }) {
                // ✅ OpenAI 1차 정규화 단계에서 이미 format(tags/sentences)을 결정했음
                const normalizedFormat = format === "tags" ? "tags" : "sentences";

                function userSpecifiesCompositionPrompt(up) {
                    if (typeof up !== "string") return false;
                    const s = up.toLowerCase();
                    if (!s.trim()) return false;

                    // 영문/국문 모두(가볍게) 커버: 구도/카메라/샷/시점 관련 키워드가 있으면
                    // 유저가 구도를 의도적으로 지정했다고 보고, 기본 구도 강제 적용을 하지 않음.
                    const patterns = [
                        /\b(full body|full-body|wide shot|long shot|establishing shot|close up|close-up|bust|portrait|headshot|upper body|half body|cowboy shot)\b/i,
                        /\b(front view|side view|profile|three[- ]quarter|3\/?4|from behind|back view|over the shoulder)\b/i,
                        /\b(low angle|high angle|bird'?s eye|top[- ]down|worm'?s eye|dutch angle|fisheye|pov|point of view|depth of field)\b/i,
                        /(전신|반신|상반신|얼굴|클로즈업|정면|측면|옆모습|후면|뒷모습|구도|카메라|앵글|시점|원근|로우앵글|하이앵글|탑다운|버드아이|피사계심도)/
                    ];
                    return patterns.some((re) => re.test(up));
                }

                // =====================
                // 1) 섹션 파싱
                // =====================
                const sections = promptResult?.sections || {};
                const subject = {
                    tags: asTags(sections.subject?.tags),
                    sentence: asSentence(sections.subject?.sentence)
                };
                const background = {
                    tags: asTags(sections.background?.tags),
                    sentence: asSentence(sections.background?.sentence)
                };

                // =====================
                // 2) 구도: 유저가 명시하지 않았으면 "얼굴+상반신 정면" 위주로 기본값 적용
                //    - 단, 유저가 구도를 직접 명시했는데(OpenAI 결과가 비어버린 경우)
                //      기본값을 강제로 넣으면 유저 의도와 충돌할 수 있으므로 비워둠.
                // =====================
                const compositionFromAI = {
                    tags: asTags(sections.composition?.tags),
                    sentence: asSentence(sections.composition?.sentence)
                };

                const defaultComposition = {
                    tags: [
                        "single character portrait",
                        "upper body",
                        "front view",
                        "centered face",
                        "chest-up close shot",
                        "protagonist framing"
                    ],
                    sentence:
                        "Single character portrait, upper body composition, front-facing view with the face centered and clearly visible."
                };

                const userWantsCustomComposition = userSpecifiesCompositionPrompt(userPrompt);
                const compositionEmpty =
                    compositionFromAI.tags.length === 0 && !compositionFromAI.sentence;

                const composition =
                    compositionEmpty
                        ? (userWantsCustomComposition ? { tags: [], sentence: "" } : defaultComposition)
                        : compositionFromAI;

                // =====================
                // 3) 그림체(style): preset이 있으면 AI 결과를 "덮어쓰기"(overwrite)
                //    - "설정 안함"(none) 계열이면 preset 없음 → AI 결과 사용
                // =====================
                const aiStyle = {
                    tags: asTags(sections.style?.tags),
                    sentence: asSentence(sections.style?.sentence)
                };

                const isSdxl = isSdxlModel(modelInfo?.model);

                // ✅ SDXL은 "그림체 프롬프트"로 강제하지 않고, LoRA(image_loras)로만 스타일을 주입합니다.
                //    - style preset/AI style 섹션은 비우고,
                //      최소한의 2D/광택 힌트만 공통으로 넣습니다.
                const normalizedStyleKey = normalizeStyleKey(jobStyleKey);

                const stylePreset = (!isSdxl && normalizedStyleKey)
                    ? STYLE_PRESETS[normalizedStyleKey]
                    : null;

                const appliedStyle = isSdxl
                    ? {
                        tags: [
                            ...SDXL_BASE_STYLE_TAGS,
                            ...(SDXL_STYLE_TRIGGER_TAGS.base || []),
                            ...((SDXL_STYLE_TRIGGER_TAGS[normalizedStyleKey] || []))
                        ],
                        sentence: "2D illustration with clean line art, cel shading, and glossy highlights."
                    }
                    : (stylePreset
                        ? {
                            tags: [...stylePreset.tags, ...aiStyle.tags.filter(t => !stylePreset.tags.includes(t))],
                            sentence: stylePreset.sentence
                        }
                        : aiStyle);


                // =====================
                // 4) 최종 프롬프트 생성: format에 따라 "하나만" 생성
                // =====================
                let tagsPrompt = "";
                let sentencePrompt = "";
                let finalPrompt = "";

                if (normalizedFormat === "tags") {
                    const allTags = [
                        ...subject.tags,
                        ...background.tags,
                        ...composition.tags,
                        ...appliedStyle.tags
                    ];
                    tagsPrompt = joinTags(allTags);
                    finalPrompt = tagsPrompt;
                } else {
                    sentencePrompt = [
                        subject.sentence,
                        background.sentence,
                        composition.sentence,
                        appliedStyle.sentence
                    ].filter(Boolean).join("\n\n");
                    finalPrompt = sentencePrompt;
                }

                const negative = {
                    tags: asTags(promptResult?.negative?.tags),
                    sentence: asSentence(promptResult?.negative?.sentence)
                };

                return {
                    format: normalizedFormat,
                    finalPrompt,
                    promptBundle: {
                        language: "en",
                        subjectType: promptResult?.subjectType || "unknown",
                        style: {
                            source: isSdxl ? "lora" : (stylePreset ? "preset" : "ai"),
                            presetKey: stylePreset ? normalizedStyleKey : null,
                            ai: aiStyle,
                            applied: appliedStyle
                        },
                        sections: { subject, background, composition },
                        negative,

                        // ✅ 디버깅/추적용: 생성된 포맷만 채우고, 나머지는 null
                        rendered: {
                            tags: tagsPrompt,
                            sentences: sentencePrompt
                        }
                    }
                };
            }

            // 4) 최종 프롬프트 렌더링 (format에 따라 tags 또는 sentences 중 하나만 사용)
            const { format, finalPrompt, promptBundle } = buildFinalPrompt({
                promptResult,
                format: desiredPromptFormat,
                jobStyleKey: job.style,
                userPrompt: job.userPrompt,
                modelInfo
            });
            // 4.5) SDXL인 경우: 스타일은 LoRA로만 주입 (image_loras)
            const isSdxl = isSdxlModel(modelInfo.model);
            const sdxlStyleKey = isSdxl ? resolveSdxlStyleKey(job.style) : null;
            const imageLoras = isSdxl ? resolveSdxlImageLoras(job, sdxlStyleKey) : [];

            if (isSdxl) {
                // 디버그/재현용으로 Firestore에 같이 저장
                promptBundle.style.imageLoras = imageLoras;
            }

            // 5) 이미지 생성
            let buffer;

            if (modelInfo.provider === "gemini") {
                buffer = await generateImageWithGemini(finalPrompt, GEMINI_API_KEY.value());
            } else {
                buffer = await generateImageWithTogether(
                    {
                        model: modelInfo.model,
                        prompt: finalPrompt,
                        width: DEFAULT_WIDTH,
                        height: DEFAULT_HEIGHT,
                        steps: modelInfo.steps,
                        guidance: modelInfo.guidance,
                        negativePrompt: modelInfo.supportsNegativePrompt
                            ? `
    low quality, worst quality, blurry,
    distorted face, deformed face, bad anatomy,
    extra fingers, extra hands, extra arms,
    missing fingers, fused fingers,
    bad hands, malformed hands,
    extra limbs, mutated body,
    cross eyes, asymmetrical eyes,
    jpeg artifacts, noisy image,
    overexposed, underexposed,
    watermark, text, logo, signature,
    cropped head, cut off face,
    background overpowering subject
    `.replace(/\s+/g, " ").trim()
                            : undefined,
                        imageLoras: isSdxl ? imageLoras : undefined
                    },
                    TOGETHER_KEY.value()
                );
            }

            // 6) Storage 업로드 (url은 미리 정해둔 storage/path/token 사용)
            const bucketName = job?.storage?.bucket;
            const storagePath = job?.storage?.path || `characters/${charId}/ai/jobs/${jobId}.png`;
            const downloadToken = job?.storage?.downloadToken || randomUUID();

            const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

            await bucket.file(storagePath).save(buffer, {
                metadata: {
                    contentType: "image/png",
                    metadata: { firebaseStorageDownloadTokens: downloadToken }
                }
            });

            const url =
                `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

            // 7) characters 문서 업데이트




            await charRef.update({
                image: { type: "ai", key: "ai", url },
                aiImages: admin.firestore.FieldValue.arrayUnion({
                    url,
                    fitScore: Number(promptResult.fitScore || 0),
                    safetyScore: Number(promptResult.safetyScore || 0),

                    // 유저가 선택한 스타일 키(없으면 null)
                    style: normalizeStyleKey(job.style),

                    modelKey,
                    model: modelInfo.model || "gemini-2.5-flash-image",
                    provider: modelInfo.provider,
                    createdAt: now,

                    // ✅ 추가: 프롬프트 저장
                    prompt: {
                        format,                 // "tags" | "sentences"
                        final: finalPrompt,     // 실제 이미지 모델에 넣은 최종 문자열
                        bundle: promptBundle    // 섹션별(캐릭터/배경/구도/그림체) + style source 등
                    }
                })
            });

            // 8) job done
            await jobRef.update({
                status: "done",
                updatedAt: Date.now(),
                finishedAt: Date.now(),
                imageUrl: url,
                result: {
                    fitScore: promptResult.fitScore,
                    safetyScore: promptResult.safetyScore,
                    provider: modelInfo.provider,
                    model: modelInfo.model || "gemini-2.5-flash-image"
                },
                error: null,
                "billing.refund.suggested": false
            });

        } catch (e) {
            logger.error("JOB_PROCESS_FAILED", jobId, e);
            await markError(
                jobRef,
                job,
                "IMAGE_GENERATION_FAILED",
                String(e?.message || e)
            );
        }
    }
);