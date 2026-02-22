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
const STYLE_PROMPTS = {
    anime2d: "2D anime style, cel shading",
    real3d: "realistic 3D render, physically based materials",
    watercolor: "watercolor illustration, soft bleeding edges",
    darkfantasy: "dark fantasy, moody lighting, high contrast",
    pixel: "pixel art, retro game style"
};

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
    together_flux1_schnell: {
        provider: "together",
        model: "black-forest-labs/FLUX.1-schnell",
        costFrames: 10,
        supportsNegativePrompt: false,
        steps: 4
    },
    together_flux2: {
        provider: "together",
        model: "black-forest-labs/FLUX.1-dev",
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
You are a professional image prompt engineer for RPG character illustrations.

[Safety]
- Do not generate sexual content involving minors.
- Avoid explicit sexual content, extreme gore, hate, or illegal content.
- If user requests disallowed content, raise safetyScore.

[Role]
- The character must always be the visual focus.
- The background must support the character but never overpower it.

[Tasks]
1. Generate a CHARACTER prompt
2. Generate a BACKGROUND prompt
3. Score evaluation
   - fitScore: 1~100
   - safetyScore: 0~100

[Strict Rules]
- Output MUST be English
- JSON only

{
  "characterPrompt": "...",
  "backgroundPrompt": "...",
  "fitScore": 1~100,
  "safetyScore": 0~100
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
                    userPrompt: job.userPrompt
                },
                openaiKey
            );

            // safety 차단
            if (Number(promptResult.safetyScore || 0) > 75) {
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

            // 3) 최종 프롬프트 조립
            const finalPrompt = `
[CHARACTER]
${promptResult.characterPrompt}

[BACKGROUND]
${promptResult.backgroundPrompt}

[COMPOSITION]
${CHARACTER_FOCUS_PROMPT}

[STYLE]
${STYLE_PROMPTS[job.style] || ""}
`.trim();

            // 4) 모델 선택
            const modelKey = (job.modelKey || "gemini").toString();
            const modelInfo = IMAGE_MODEL_MAP[modelKey];
            if (!modelInfo) {
                await markError(jobRef, job, "INVALID_MODEL", "Unknown modelKey");
                return;
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
                            ? "blurry, low quality, distorted, extra fingers, extra limbs, text, watermark"
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
                    fitScore: promptResult.fitScore,
                    safetyScore: promptResult.safetyScore,
                    style: job.style || null,
                    modelKey,
                    model: modelInfo.model || "gemini-2.5-flash-image",
                    provider: modelInfo.provider,
                    createdAt: now
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