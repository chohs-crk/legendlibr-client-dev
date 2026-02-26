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
    anime2d: {
        tags: ["2D anime", "clean lineart", "cel shading", "vibrant colors"],
        sentence: "2D anime illustration with clean line art and crisp cel shading, vibrant colors."
    },
    real3d: {
        tags: ["realistic 3D render", "physically based materials", "cinematic lighting", "high detail"],
        sentence: "Realistic 3D render with physically based materials, high detail, and cinematic lighting."
    },
    watercolor: {
        tags: ["watercolor illustration", "soft bleeding edges", "paper texture", "gentle gradients"],
        sentence: "Watercolor illustration with soft bleeding edges, paper texture, and gentle gradients."
    },
    darkfantasy: {
        tags: ["dark fantasy", "moody lighting", "high contrast", "dramatic shadows"],
        sentence: "Dark fantasy illustration with moody lighting, high contrast, and dramatic shadows."
    },
    pixel: {
        tags: ["pixel art", "retro game style", "limited palette", "crisp pixels"],
        sentence: "Pixel art in a retro game style with crisp pixels and a limited color palette."
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
async function buildImagePromptAndScore(input, openaiKey) {
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
- Penalize contradiction (e.g., holy knight described in fullStory but userPrompt requests neon cyberpunk clown).
- Score must be between 1 and 100.

[Safety]
- Do not generate sexual content involving minors.
- Avoid explicit sexual content, extreme gore, hate, or illegal content.
- If user requests disallowed content, set safetyScore high (0~100).
[SafetyScore Evaluation]

You must assign a safetyScore between 0 and 100.

SafetyScore definition (Higher = More Dangerous):

0–10:
Completely safe. Neutral portrait, no suggestive elements, no sensual focus.

11–25:
Mild aesthetic attractiveness only. Normal fashion. No exposed body emphasis.

26–40:
Noticeable physical emphasis (slim waist, blush, smirk, off-shoulder clothing, tight outfit).
Light sensual undertone but no explicit sexualization.

41–60:
Clear sexual suggestiveness.
Exposed shoulders slipping, cropped tops emphasizing body shape,
focus on chest/hips/thighs, seductive expressions, provocative pose.

61–80:
Strong sexualization.
Explicit body focus, cleavage emphasis, fetish elements,
lingerie-level exposure, dominant erotic framing.

81–100:
Explicit sexual content, sexual acts, minors, extreme fetish, illegal content.
Must be blocked.

Scoring Rules:
- Be conservative. If unsure, score higher.
- Body emphasis + seductive expression = add 10–20 points.
- Clothing described as slipping, tight, cropped, body-hugging = add 5–15 points.
- If composition focuses on chest/hips/legs, increase score significantly.
- If age is unclear and character looks young, increase score.
- If any minor possibility exists → 90+.

If safetyScore > 70, consider it high risk.
If safetyScore > 90, it must be blocked.
[Goal]
Create image prompts where the MAIN SUBJECT is always the visual focus.
The subject can be human, animal, creature, object, abstract concept, or environment.
Do NOT force a human if the request is not about a person.

[Output formats]
You MUST output BOTH:
1) tags: for Flux-style prompting (short phrases, NOT full sentences)
   - Each tag is 1~5 words, English only
   - No commas inside a tag
2) sentence: for sentence-style prompting (English sentences)

[Sections]
You MUST produce these sections:
- subject (main subject description)
- background (supporting scene, never overpower the subject)
- composition (camera, framing, focus, perspective)
- style (rendering style suggestion; even if styleKey exists, still generate an AI style suggestion)

[Strict Rules]
- Output MUST be English
- JSON only (no markdown, no extra text)
- Keep tags lists compact (8~25 tags per section)

Return JSON with this exact shape:

[Context Usage Rules]
- fullStory describes the character's lore, personality, and world setting.
- promptRefined describes the core visual identity.
- userPrompt is a requested modification or addition.

You must check if userPrompt logically fits within the established character world.

{
  "subjectType": "human|animal|creature|object|abstract|environment",
  "sections": {
    "subject": { "tags": ["..."], "sentence": "..." },
    "background": { "tags": ["..."], "sentence": "..." },
    "composition": { "tags": ["..."], "sentence": "..." },
    "style": { "tags": ["..."], "sentence": "..." }
  },
  "negative": { "tags": ["..."], "sentence": "..." },
  "fitScore": 0,
  "safetyScore": 0
}
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
    { model, prompt, width, height, steps, guidance, negativePrompt, seed },
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

            // 2) OpenAI로 prompt 구성 + score
            const openaiKey = OPENAI_KEY.value();
            const promptResult = await buildImagePromptAndScore(
                {
                    promptRefined: char.promptRefined,
                    fullStory: char.fullStory ?? char.finalStory,
                    userPrompt: job.userPrompt,

                    // ✅ 프롬프트 엔지니어링 컨텍스트(시스템 프롬프트에 이미 정의됨)
                    styleKey: normalizeStyleKey(job.style),
                    modelKey: (job.modelKey || "gemini").toString()
                },
                openaiKey
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

            function buildFinalPrompt({ promptResult, modelInfo, jobStyleKey, userPrompt }) {
                // ✅ provider 기준 분기
                // - together: 키워드(태그) 기반
                // - gemini: 문장(단락) 기반
                const useTagsFormat = modelInfo.provider === "together";

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
                // 2) 구도: 유저가 명시하지 않았으면 "얼굴+상반신 정면" 위주로 강제
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
                        ? defaultComposition
                        : compositionFromAI;

                // =====================
                // 3) 그림체(style): preset이 있으면 AI 결과를 "덮어쓰기"(overwrite)
                //    - "설정 안함"(none) 계열이면 preset 없음 → AI 결과 사용
                // =====================
                const aiStyle = {
                    tags: asTags(sections.style?.tags),
                    sentence: asSentence(sections.style?.sentence)
                };

                const normalizedStyleKey = normalizeStyleKey(jobStyleKey);
                const stylePreset = normalizedStyleKey ? STYLE_PRESETS[normalizedStyleKey] : null;

                const appliedStyle = stylePreset
                    ? {
                        tags: [...stylePreset.tags, ...aiStyle.tags.filter(t => !stylePreset.tags.includes(t))],
                        sentence: stylePreset.sentence
                    }
                    : aiStyle;

                // =====================
                // 4) 태그/문장 프롬프트를 각각 생성한 뒤, provider에 따라 선택
                // =====================
                function buildTagsPrompt() {
                    const allTags = [
                        ...subject.tags,
                        ...background.tags,
                        ...composition.tags,
                        ...appliedStyle.tags
                    ];
                    return joinTags(allTags);
                }

                function buildSentencePrompt() {
                    return [
                        subject.sentence,
                        background.sentence,
                        composition.sentence,
                        appliedStyle.sentence
                    ].filter(Boolean).join("\n\n");
                }

                const tagsPrompt = buildTagsPrompt();
                const sentencePrompt = buildSentencePrompt();

                const format = useTagsFormat ? "tags" : "sentences";
                const finalPrompt = useTagsFormat ? tagsPrompt : sentencePrompt;

                const negative = {
                    tags: asTags(promptResult?.negative?.tags),
                    sentence: asSentence(promptResult?.negative?.sentence)
                };

                return {
                    format,
                    finalPrompt,
                    promptBundle: {
                        language: "en",
                        subjectType: promptResult?.subjectType || "unknown",
                        style: {
                            source: stylePreset ? "preset" : "ai",
                            presetKey: stylePreset ? normalizedStyleKey : null,
                            ai: aiStyle,
                            applied: appliedStyle
                        },
                        sections: { subject, background, composition },
                        negative,

                        // (선택) 디버깅/추적용: 둘 다 저장해두면 이후 모델 변경에도 재사용 가능
                        rendered: {
                            tags: tagsPrompt,
                            sentences: sentencePrompt
                        }
                    }
                };
            }

            // 4) 모델 선택
            const modelKey = (job.modelKey || "gemini").toString();
            const modelInfo = IMAGE_MODEL_MAP[modelKey];
            if (!modelInfo) {
                await markError(jobRef, job, "INVALID_MODEL", "Unknown modelKey");
                return;
            }
            const { format, finalPrompt, promptBundle } = buildFinalPrompt({
                promptResult,
                modelInfo,
                jobStyleKey: job.style,
                userPrompt: job.userPrompt
            });
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
                            : undefined
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