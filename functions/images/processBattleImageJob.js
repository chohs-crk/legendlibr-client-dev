"use strict";

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const { generateBattleImageWithGemini } = require("./image/image.providers");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const firestore = admin.firestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const OPENAI_KEY = defineSecret("OPENAI_KEY");
const OPENAI_PROMPT_MODEL = "gpt-5-mini";

/* =========================
   utils
========================= */
function stripJsonFence(v) {
    if (typeof v !== "string") return "";
    return v
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function parseJsonLoose(text) {
    const cleaned = stripJsonFence(text);
    try {
        return JSON.parse(cleaned);
    } catch (_) {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error("OPENAI_JSON_PARSE_FAILED");
    }
}

function asSafeString(v, max = 8000) {
    if (typeof v !== "string") return "";
    return v.trim().slice(0, max);
}

async function markBattleError(jobRef, battleRef, jobData, code, message, extra = {}) {
    const now = Date.now();

    await jobRef.update({
        status: "error",
        updatedAt: now,
        finishedAt: now,
        error: { code, message },
        "billing.refund.suggested": false,
        ...extra
    });

    if (battleRef) {
        await battleRef.set(
            {
                image: "called",
                imageCalled: true,
                imageJobId: jobRef.id,
                battleImage: {
                    latestJobId: jobRef.id,
                    status: "error",
                    url: null,
                    error: { code, message },
                    updatedAt: now
                }
            },
            { merge: true }
        );
    }
}

async function fetchImageAsInlineData(url, label) {
    if (!url || typeof url !== "string") {
        throw new Error(`SOURCE_IMAGE_MISSING_${label.toUpperCase()}`);
    }

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`SOURCE_IMAGE_FETCH_FAILED_${label.toUpperCase()}`);
    }

    const mimeType = (res.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
    const arr = await res.arrayBuffer();
    const buffer = Buffer.from(arr);

    if (!buffer.length) {
        throw new Error(`SOURCE_IMAGE_EMPTY_${label.toUpperCase()}`);
    }

    return {
        mimeType,
        data: buffer.toString("base64")
    };
}

async function buildBattlePromptWithOpenAI(payload, openaiKey) {
    const systemPrompt = `
You are a professional battle illustration prompt engineer.

Your task:
- Read the battle log and both characters' identity references.
- Choose either the ending scene or the single most dramatic peak moment.
- Preserve both characters' identity from the supplied references and input images.
- Output a single cinematic image prompt for one wide 16:9 frame.
- Do NOT create a split image, card layout, UI, text, or multiple panels.

Violence policy:
- Mild to strong fantasy violence is allowed.
- If the source implies gore beyond an R/19+ level, reduce gore while keeping the dramatic impact.
- Never include exposed organs, dismemberment detail, or extreme mutilation.
- If there is blood, keep it limited and cinematic rather than explicit.

Composition goals:
- Both characters must appear in the same frame.
- The winner or momentum should be visually readable.
- Use dynamic camera, environment, lighting, and action beat.
- Prioritise readability, identity consistency, and cinematic staging.

Return JSON only in this exact shape:
{
  "sceneType": "ending|climax",
  "violenceLevel": "softened|allowed",
  "prompt": "...",
  "negativePrompt": "...",
  "reason": "...",
  "safetyScore": 0
}
`.trim();

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: OPENAI_PROMPT_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(payload) }
            ]
        })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.error?.message || "OPENAI_BATTLE_PROMPT_FAILED");
    }

    const text = json?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonLoose(text);

    return {
        sceneType: parsed?.sceneType === "ending" ? "ending" : "climax",
        violenceLevel: parsed?.violenceLevel === "softened" ? "softened" : "allowed",
        prompt: asSafeString(parsed?.prompt, 6000),
        negativePrompt: asSafeString(parsed?.negativePrompt, 2000),
        reason: asSafeString(parsed?.reason, 1000),
        safetyScore: Number(parsed?.safetyScore || 0),
        usage: json?.usage || null
    };
}

/* =========================
   Trigger
========================= */
exports.processBattleImageJob = onDocumentCreated(
    {
        document: "battleImageJobs/{jobId}",
        timeoutSeconds: 540,
        memory: "1GiB",
        secrets: [GEMINI_API_KEY, OPENAI_KEY]
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const jobRef = snap.ref;
        const jobId = event.params.jobId;

        try {
            const locked = await firestore.runTransaction(async (tx) => {
                const cur = await tx.get(jobRef);
                if (!cur.exists) return false;

                const curData = cur.data() || {};
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
            logger.error("BATTLE_IMAGE_JOB_LOCK_FAILED", jobId, e);
            return;
        }

        const jobSnap = await jobRef.get();
        const job = jobSnap.data() || {};
        const battleId = job?.battleId || null;
        const battleRef = battleId ? firestore.collection("battles").doc(battleId) : null;

        try {
            if (!battleId || !job?.uid) {
                await markBattleError(jobRef, battleRef, job, "INVALID_JOB", "battleId 또는 uid가 누락된 배틀 이미지 작업입니다.");
                return;
            }

            const [battleSnap2, myCharSnap, enemyCharSnap] = await Promise.all([
                battleRef.get(),
                job?.myId ? firestore.collection("characters").doc(job.myId).get() : null,
                job?.enemyId ? firestore.collection("characters").doc(job.enemyId).get() : null
            ]);

            if (!battleSnap2.exists) {
                await markBattleError(jobRef, battleRef, job, "BATTLE_NOT_FOUND", "전투 문서를 찾을 수 없습니다.");
                return;
            }

            const battle = battleSnap2.data() || {};
            const myChar = myCharSnap?.exists ? (myCharSnap.data() || {}) : null;
            const enemyChar = enemyCharSnap?.exists ? (enemyCharSnap.data() || {}) : null;

            const myImageUrl =
                asSafeString(myChar?.image?.url, 2000) ||
                asSafeString(job?.myImage, 2000);
            const enemyImageUrl =
                asSafeString(enemyChar?.image?.url, 2000) ||
                asSafeString(job?.enemyImage, 2000);

            if (!myImageUrl || !enemyImageUrl) {
                await markBattleError(
                    jobRef,
                    battleRef,
                    job,
                    "SOURCE_IMAGE_MISSING_AT_PROCESS",
                    "생성 시점에 두 캐릭터의 대표 이미지를 모두 확인하지 못했습니다."
                );
                return;
            }

            const promptResult = await buildBattlePromptWithOpenAI(
                {
                    battleId,
                    myName: battle?.myName || job?.myName || "공격자",
                    enemyName: battle?.enemyName || job?.enemyName || "수비자",
                    winnerId: battle?.winnerId || job?.winnerId || null,
                    loserId: battle?.loserId || job?.loserId || null,
                    battleLogs: Array.isArray(job?.battleContext?.logs)
                        ? job.battleContext.logs
                        : [],
                    previewText: asSafeString(job?.battleContext?.previewText || battle?.previewText || "", 2000),
                    userPrompt: asSafeString(job?.userPromptRaw || "", 2000),
                    queuePrompt: asSafeString(job?.userPrompt || "", 4000),
                    characters: {
                        my: {
                            name: battle?.myName || job?.myName || "공격자",
                            promptRefined: asSafeString(
                                myChar?.promptRefined || job?.battleContext?.promptRefined?.my || "",
                                3000
                            ),
                            fullStory: asSafeString(
                                myChar?.fullStory || myChar?.finalStory || job?.battleContext?.fullStory?.my || "",
                                5000
                            )
                        },
                        enemy: {
                            name: battle?.enemyName || job?.enemyName || "수비자",
                            promptRefined: asSafeString(
                                enemyChar?.promptRefined || job?.battleContext?.promptRefined?.enemy || "",
                                3000
                            ),
                            fullStory: asSafeString(
                                enemyChar?.fullStory || enemyChar?.finalStory || job?.battleContext?.fullStory?.enemy || "",
                                5000
                            )
                        }
                    }
                },
                OPENAI_KEY.value()
            );

            if (!promptResult?.prompt) {
                await markBattleError(
                    jobRef,
                    battleRef,
                    job,
                    "PROMPT_BUILD_EMPTY",
                    "배틀 이미지 프롬프트를 생성하지 못했습니다."
                );
                return;
            }

            const [myRefImage, enemyRefImage] = await Promise.all([
                fetchImageAsInlineData(myImageUrl, "my"),
                fetchImageAsInlineData(enemyImageUrl, "enemy")
            ]);

            const buffer = await generateBattleImageWithGemini(
                {
                    prompt: promptResult.prompt,
                    aspectRatio: "16:9",
                    references: [myRefImage, enemyRefImage]
                },
                GEMINI_API_KEY.value()
            );

            const storagePath = job?.storage?.path || `battles/${battleId}/images/${jobId}.png`;
            const downloadToken = job?.storage?.downloadToken || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const bucket = admin.storage().bucket();

            await bucket.file(storagePath).save(buffer, {
                metadata: {
                    contentType: "image/png",
                    metadata: { firebaseStorageDownloadTokens: downloadToken }
                }
            });

            const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
                storagePath
            )}?alt=media&token=${downloadToken}`;

            const completedAt = Date.now();

            await jobRef.update({
                status: "done",
                updatedAt: completedAt,
                finishedAt: completedAt,
                result: {
                    imageUrl,
                    provider: "gemini",
                    model: "gemini-2.5-flash-image",
                    sceneType: promptResult.sceneType,
                    violenceLevel: promptResult.violenceLevel,
                    safetyScore: Number(promptResult.safetyScore || 0),
                    prompt: {
                        final: promptResult.prompt,
                        negative: promptResult.negativePrompt || "",
                        reason: promptResult.reason || "",
                        openai: {
                            model: OPENAI_PROMPT_MODEL,
                            usage: promptResult.usage || null
                        }
                    }
                },
                error: null,
                "billing.refund.suggested": false
            });

            await battleRef.set(
                {
                    image: "called",
                    imageCalled: true,
                    imageJobId: jobId,
                    battleImage: {
                        latestJobId: jobId,
                        status: "done",
                        url: imageUrl,
                        error: null,
                        updatedAt: completedAt
                    }
                },
                { merge: true }
            );
        } catch (e) {
            logger.error("BATTLE_IMAGE_JOB_FAILED", jobId, e);
            await markBattleError(
                jobRef,
                battleRef,
                job,
                "IMAGE_GENERATION_FAILED",
                String(e?.message || e || "배틀 이미지 생성에 실패했습니다.")
            );
        }
    }
);
