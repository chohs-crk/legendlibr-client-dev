"use strict";

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { randomUUID } = require("crypto");
const nodePath = require("path");
const { pathToFileURL } = require("url");

let ORIGINS_CACHE = undefined;
const OPENAI_PROMPT_MODEL = "gpt-5-mini";

/**
 * Loads ORIGINS map from /battles/origins.js (ESM) with a few fallback paths.
 * This function is intentionally resilient because Functions (CJS) must import ESM.
 */
async function loadOriginsMap() {
    if (ORIGINS_CACHE !== undefined) return ORIGINS_CACHE;

    const candidates = [
        "./battles/origins.js",
        "../battles/origins.js",
        "./origins.js",
        "../origins.js"
    ];

    for (const rel of candidates) {
        try {
            const url = pathToFileURL(nodePath.join(__dirname, rel)).href;
            const mod = await import(url);
            const origins = mod?.ORIGINS || mod?.default?.ORIGINS || mod?.default;
            if (origins && typeof origins === "object") {
                ORIGINS_CACHE = origins;
                return ORIGINS_CACHE;
            }
        } catch (_) {
            // try next
        }
    }

    ORIGINS_CACHE = null;
    return ORIGINS_CACHE;
}

function getOriginBackground(originsMap, originId) {
    if (!originsMap || typeof originId !== "string" || !originId.trim()) return null;
    const bg = originsMap?.[originId]?.background;
    return typeof bg === "string" && bg.trim() ? bg.trim() : null;
}

const {
    IMAGE_MODEL_MAP,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    normalizeStyleKey,
    resolvePromptFormat
} = require("./image/image.config");

const { buildImagePromptAndScore, buildFinalPrompt } = require("./image/prompt.builder");
const { generateImageWithGemini, generateImageWithTogether } = require("./image/image.providers");

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
   utils
========================= */
async function mutateCharacterAiImages(charId, updater) {
    if (!charId) return;

    const charRef = firestore.collection("characters").doc(charId);

    await firestore.runTransaction(async (tx) => {
        const charSnap = await tx.get(charRef);
        if (!charSnap.exists) return;

        const char = charSnap.data() || {};
        const currentAiImages = Array.isArray(char.aiImages) ? char.aiImages : [];
        const nextAiImages = updater(currentAiImages, char);

        if (!Array.isArray(nextAiImages)) return;

        tx.update(charRef, { aiImages: nextAiImages });
    });
}

async function markError(jobRef, jobData, code, message, extra = {}) {
    const now = Date.now();
    const refundSuggested = code !== "SAFETY_BLOCKED"; // 안전차단은 환불 X
    const refundFrames = Number(jobData?.billing?.refund?.frames || jobData?.costFrames || 0);

    const payload = {
        status: "error",
        updatedAt: now,
        finishedAt: now,
        error: { code, message },
        "billing.refund.suggested": refundSuggested,
        "billing.refund.frames": refundFrames,
        ...extra
    };

    if (!Object.prototype.hasOwnProperty.call(payload, "result") && jobData?.result) {
        payload.result = jobData.result;
    }

    await jobRef.update(payload);

    try {
        const failedJobId = jobRef.id;
        const failedImageUrl = jobData?.imageUrl || null;

        await mutateCharacterAiImages(jobData?.charId, (currentAiImages) =>
            currentAiImages.filter((ai) => {
                const sameJob = typeof ai?.jobId === "string" && ai.jobId === failedJobId;
                const sameUrl = !!failedImageUrl && ai?.url === failedImageUrl;
                return !(sameJob || sameUrl);
            })
        );
    } catch (e) {
        logger.error("PENDING_AI_IMAGE_REMOVE_FAILED", jobRef.id, e);
    }
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

            if (!locked) return;
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

            // 1.5) origin background (job.originId 우선, 없으면 character.originId)
            const originId =
                typeof job.originId === "string" && job.originId.trim()
                    ? job.originId.trim()
                    : typeof char.originId === "string" && char.originId.trim()
                        ? char.originId.trim()
                        : null;

            const originsMap = await loadOriginsMap();
            const originBackground = getOriginBackground(originsMap, originId);

            // 2) 모델 선택
            const modelKey = (job.modelKey || "gemini").toString();
            const modelInfo = IMAGE_MODEL_MAP[modelKey];
            if (!modelInfo) {
                await markError(jobRef, job, "INVALID_MODEL", "Unknown modelKey");
                return;
            }

            // 3) OpenAI로 prompt 구성 + score
            const desiredPromptFormat = resolvePromptFormat(job, modelInfo);
            const openaiKey = OPENAI_KEY.value();

            const promptResult = await buildImagePromptAndScore(
                {
                    promptRefined: char.promptRefined,
                    fullStory: char.fullStory ?? char.finalStory,
                    userPrompt: job.userPrompt,

                    // origin 컨텍스트: background 우선 적용 + prompt 제작 AI에도 힌트로 제공
                    originId,
                    originBackground,

                    styleKey: normalizeStyleKey(job.style),
                    modelKey
                },
                openaiKey,
                { format: desiredPromptFormat }
            );

            const openaiUsage = promptResult?.usage || null;
            job.result = {
                fitScore: Number(promptResult.fitScore || 0),
                safetyScore: Number(promptResult.safetyScore || 0),
                provider: null,
                model: null,
                openai: {
                    model: OPENAI_PROMPT_MODEL,
                    usage: openaiUsage
                }
            };

            // safety 차단
            if (Number(promptResult.safetyScore || 0) > 95) {
                await markError(jobRef, job, "SAFETY_BLOCKED", "Prompt blocked by safety policy", {
                    result: job.result
                });
                return;
            }

            // 4) 최종 프롬프트 렌더링
            const { format, finalPrompt, promptBundle } = buildFinalPrompt({
                promptResult,
                format: desiredPromptFormat,
                jobStyleKey: job.style,
                userPrompt: job.userPrompt,
                modelInfo,
                originBackground,
                modelKey
            });

            // 5) 이미지 생성
            let buffer;

            if (modelInfo.provider === "gemini") {
                buffer = await generateImageWithGemini(finalPrompt, GEMINI_API_KEY.value());
            } else {
                // ✅ negativePrompt: 주석 제거 / 키워드만
                const NEGATIVE_PROMPT = `
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
background overpowering subject,
photorealistic,
hyper realistic,
realistic skin,
cinematic realism,
DSLR photo,
subsurface scattering skin,
skin pores,
3D render,
octane render,
ray tracing,
volumetric realism,
full body view,
entire body visible,
character standing full length,
zoomed out camera,
wide framing,
establishing composition,
character sheet layout,
reference pose,
concept turnaround,
excessive background,
establishing shot,
character sheet,
concept art,
concept sheet,
reference sheet,
model sheet,
turnaround,
front and back view,
multiple angles,
orthographic view,
T-pose,
pose reference,
design sheet,
character design layout,
side by side views,
multiple poses
`.replace(/\s+/g, " ").trim();

                buffer = await generateImageWithTogether(
                    {
                        model: modelInfo.model,
                        prompt: finalPrompt,
                        width: DEFAULT_WIDTH,
                        height: DEFAULT_HEIGHT,
                        steps: modelInfo.steps,
                        guidance: modelInfo.guidance,
                        negativePrompt: modelInfo.supportsNegativePrompt ? NEGATIVE_PROMPT : undefined
                    },
                    TOGETHER_KEY.value()
                );
            }

            // 6) Storage 업로드
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

            const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
                storagePath
            )}?alt=media&token=${downloadToken}`;

            // 7) characters 문서 업데이트
            const completedAt = Date.now();
            const readyAiImage = {
                jobId,
                url,
                ready: true,
                fitScore: Number(promptResult.fitScore || 0),
                safetyScore: Number(promptResult.safetyScore || 0),
                style: normalizeStyleKey(job.style),
                modelKey,
                model: modelInfo.model || "gemini-2.5-flash-image",
                provider: modelInfo.provider,
                updatedAt: completedAt,
                prompt: {
                    format,
                    final: finalPrompt,
                    bundle: promptBundle,
                    openai: {
                        model: OPENAI_PROMPT_MODEL,
                        usage: openaiUsage
                    }
                }
            };

            await mutateCharacterAiImages(charId, (currentAiImages) => {
                const index = currentAiImages.findIndex(
                    (ai) =>
                        (typeof ai?.jobId === "string" && ai.jobId === jobId) ||
                        ai?.url === url
                );

                if (index >= 0) {
                    const nextAiImages = [...currentAiImages];
                    const prev = nextAiImages[index] || {};
                    nextAiImages[index] = {
                        ...prev,
                        ...readyAiImage,
                        createdAt: prev.createdAt || now
                    };
                    return nextAiImages;
                }

                return [
                    ...currentAiImages,
                    {
                        ...readyAiImage,
                        createdAt: completedAt
                    }
                ];
            });

            // 8) job done
            await jobRef.update({
                status: "done",
                updatedAt: Date.now(),
                finishedAt: Date.now(),
                imageUrl: url,
                result: {
                    fitScore: Number(promptResult.fitScore || 0),
                    safetyScore: Number(promptResult.safetyScore || 0),
                    provider: modelInfo.provider,
                    model: modelInfo.model || "gemini-2.5-flash-image",
                    openai: {
                        model: OPENAI_PROMPT_MODEL,
                        usage: openaiUsage
                    }
                },
                error: null,
                "billing.refund.suggested": false
            });
        } catch (e) {
            logger.error("JOB_PROCESS_FAILED", jobId, e);
            await markError(jobRef, job, "IMAGE_GENERATION_FAILED", String(e?.message || e));
        }
    }
);


