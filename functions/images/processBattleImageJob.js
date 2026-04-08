"use strict";

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const { generateBattleImageWithGemini, generateBattleImageWithTogether } = require("./image/image.providers");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const firestore = admin.firestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const OPENAI_KEY = defineSecret("OPENAI_KEY");
const TOGETHER_KEY = defineSecret("TOGETHER_KEY");
const OPENAI_PROMPT_MODEL = "gpt-5-mini";

const DEFAULT_BATTLE_MODEL_KEY = "gemini";
const BATTLE_IMAGE_MODEL_MAP = {
    gemini: {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        aspectRatio: "16:9"
    },
    together_flux2_dev: {
        provider: "together",
        model: "black-forest-labs/FLUX.2-dev",
        width: 1344,
        height: 768,
        steps: 20
    }
};

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
    return v.trim().replace(/\s+/g, " ").slice(0, max);
}

function getBattleImageUrl(imageField) {
    if (typeof imageField === "string") {
        return asSafeString(imageField, 2000);
    }

    if (typeof imageField?.url === "string") {
        return asSafeString(imageField.url, 2000);
    }

    return "";
}

function safeLines(list, maxItems = 12, maxItemLength = 240) {
    if (!Array.isArray(list)) return [];
    return list
        .map((v) => asSafeString(v, maxItemLength))
        .filter(Boolean)
        .slice(0, maxItems);
}

function resolveBattleSides({ battle, job }) {
    const myId = asSafeString(job?.myId || battle?.myId || "", 200);
    const enemyId = asSafeString(job?.enemyId || battle?.enemyId || "", 200);
    const winnerId = asSafeString(battle?.winnerId || job?.winnerId || "", 200);
    const loserId = asSafeString(battle?.loserId || job?.loserId || "", 200);

    let winnerSide = null;
    let loserSide = null;

    if (winnerId && myId && winnerId === myId) winnerSide = "my";
    else if (winnerId && enemyId && winnerId === enemyId) winnerSide = "enemy";

    if (loserId && myId && loserId === myId) loserSide = "my";
    else if (loserId && enemyId && loserId === enemyId) loserSide = "enemy";

    if (!winnerSide && loserSide === "my") winnerSide = "enemy";
    if (!winnerSide && loserSide === "enemy") winnerSide = "my";
    if (!loserSide && winnerSide === "my") loserSide = "enemy";
    if (!loserSide && winnerSide === "enemy") loserSide = "my";

    return {
        myId,
        enemyId,
        winnerId,
        loserId,
        winnerSide,
        loserSide
    };
}

function buildReferenceLockedBattlePrompt({
    scenePrompt,
    myName,
    enemyName,
    winnerSide,
    loserSide,
    violenceLevel,
    negativePrompt,
    provider = "gemini"
}) {
    const winnerName = winnerSide === "my" ? myName : winnerSide === "enemy" ? enemyName : "the winner";
    const loserName = loserSide === "my" ? myName : loserSide === "enemy" ? enemyName : "the loser";

    const styleLine = winnerSide
        ? `If the two reference images have different illustration styles, unify the final rendering primarily around ${winnerName}'s reference style because ${winnerName} has the winning momentum, while still keeping ${loserName}'s own design language, silhouette, and visual vibe clearly recognizable.`
        : `Blend the illustration feel of both reference images naturally. If their styles differ, choose one coherent render style without erasing either character's unique visual identity.`;

    const violenceLine =
        violenceLevel === "softened"
            ? "Keep the violence cinematic and emotionally intense, but soften any gore beyond an R/19+ feel. No explicit mutilation, exposed organs, or graphic dismemberment."
            : "Fantasy violence is allowed, but keep it cinematic rather than graphically gory. No explicit mutilation, exposed organs, or graphic dismemberment.";

    if (provider === "together") {
        return [
            "Create one finished cinematic battle illustration in a wide 16:9 frame.",
            `image 1 is ${myName}. image 2 is ${enemyName}. Never swap their identities.`,
            `Use image 1 as the identity reference for ${myName} and image 2 as the identity reference for ${enemyName}.`,
            "Preserve each character's recognizable face, hairstyle, eye feel, outfit silhouette, weapon, wings or major body traits, accessories, and color language from the matching reference image.",
            styleLine,
            "Treat the reference images as identity guides only, not as pose, crop, or camera guides.",
            "Compose a brand-new decisive action moment with both characters visible in the same frame and actively interacting in one shared scene.",
            "Use strong motion cues such as body twist, leap, recoil, strike, weapon swing arcs, cloth and hair movement, shockwaves, dust, debris, or energy trails.",
            "Use a dynamic cinematic camera angle such as low angle, diagonal composition, over-the-shoulder, or strong perspective rather than a neutral portrait view.",
            "Keep the final result as one clean finished illustration with no UI, no text, no logo, no watermark, no split panels, and no character-sheet layout.",
            "Keep anatomy, hands, weapons, and contact readable and coherent.",
            `${myName} and ${enemyName} must remain clearly separate characters from image 1 and image 2, not merged or redesigned into generic substitutes.`,
            "Make the winner's momentum readable at a glance while keeping the other fighter expressive and visually meaningful.",
            violenceLine,
            `Scene direction: ${asSafeString(scenePrompt, 1400)}`
        ]
            .filter(Boolean)
            .join(" ");
    }

    const avoidLine = negativePrompt
        ? `Avoid: ${asSafeString(negativePrompt, 500)}.`
        : "Avoid: split panels, UI, text, logos, character sheets, reference turnarounds, exact pose copying, face swaps, and generic redesigns.";

    return [
        "Create one single wide 16:9 battle illustration with both characters in the same shared frame.",
        `Reference image 1 (the first attached image) is ${myName}. Reference image 2 (the second attached image) is ${enemyName}. Never swap which character each reference image belongs to.`,
        `Use reference image 1 as the ground-truth visual identity for ${myName}, and reference image 2 as the ground-truth visual identity for ${enemyName}.`,
        "Preserve each character's recognizable face, hairstyle, eye feel, outfit silhouette, weapon, wings or major body traits, accessories, and color language from their own reference image.",
        styleLine,
        "Do not force a separate preset art style such as photorealism, oil painting, 3D render, or a fixed anime template. Let the final image inherit its overall illustration feel from the two character references.",
        "Do not copy the exact static pose, camera angle, crop, or composition from either reference image.",
        "Instead, you MUST reinterpret both characters into completely new, dynamic, action-driven poses that reflect motion, impact, and interaction between them.",
        "Both characters must be actively engaged in the same moment (attack, clash, dodge, impact, or aftermath), not standing or posing independently.",
        "Use strong motion cues such as body twist, limb extension, weapon swing arcs, hair or cloth movement, energy trails, or environmental interaction (dust, debris, shockwaves).",
        "Camera must NOT be a neutral portrait angle. Use cinematic framing such as low-angle, over-the-shoulder, diagonal composition, or dynamic perspective.",
        "Avoid static character sheet feeling, idle standing poses, or symmetrical front-facing compositions.",
        "Do NOT generate a result where both characters are simply standing, facing camera, or lightly interacting.",
        "The scene must clearly show motion, tension, and a decisive moment (impact, clash, or turning point).",
        "At least one character must be mid-action (attacking, reacting, or being affected).",
        `${myName} and ${enemyName} must both feel like the same characters from their own references, even though the battle scene is newly staged and dynamically composed.`,
        "Make the winner or momentum readable at a glance, but keep the loser expressive and visually meaningful rather than disposable.",
        violenceLine,
        avoidLine,
        `Scene direction: ${asSafeString(scenePrompt, 1400)}`
    ]
        .filter(Boolean)
        .join(" ");
}

function resolveBattleModelInfo(modelKey) {
    const raw = typeof modelKey === "string" ? modelKey.trim() : "";
    return {
        modelKey: raw && BATTLE_IMAGE_MODEL_MAP[raw] ? raw : DEFAULT_BATTLE_MODEL_KEY,
        modelInfo: BATTLE_IMAGE_MODEL_MAP[raw] || BATTLE_IMAGE_MODEL_MAP[DEFAULT_BATTLE_MODEL_KEY]
    };
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
                    modelKey: jobData?.modelKey || null,
                    costFrames: Number(jobData?.costFrames || jobData?.billing?.chargedFrames || 0) || null,
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
You are a professional battle illustration scene planner.

Your task:
- Read the battle log and both characters' identity references.
- Choose either the ending scene or the single most dramatic peak moment.
- Produce a concise SCENE DIRECTION prompt for one wide 16:9 illustration.
- Focus on action, camera, staging, environment, momentum, emotion, and readability.
- Both characters must appear in the same frame.
- Do NOT create split images, cards, UI, text, multiple panels, or character sheets.

Identity + style rules:
- The attached reference images will define the characters' visual identity and illustration feel.
- Do NOT invent a replacement art style such as photorealistic, oil painting, 3D render, or fixed anime preset.
- Do NOT overwrite the reference identities with a generic dark fantasy redesign.
- Do NOT ask for the characters to repeat the exact pose or crop from their reference images.
- Instead, describe new scene-appropriate movement and staging.

Violence policy:
- Mild to strong fantasy violence is allowed.
- If the source implies gore beyond an R/19+ level, reduce gore while keeping the dramatic impact.
- Never include exposed organs, dismemberment detail, or extreme mutilation.
- If there is blood, keep it limited and cinematic rather than explicit.
Action requirements:
        - The scene must depict motion, not a static pose.
        - Prefer moments like impact, clash, or mid-action rather than idle stance.
        - Include dynamic body movement (twist, jump, strike, recoil, etc.).
        - Avoid neutral standing or portrait-like framing.
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
        prompt: asSafeString(parsed?.prompt, 1600),
        negativePrompt: asSafeString(parsed?.negativePrompt, 700),
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
        secrets: [GEMINI_API_KEY, OPENAI_KEY, TOGETHER_KEY]
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
            const sideInfo = resolveBattleSides({ battle, job });

            const myName = asSafeString(battle?.myName || job?.myName || myChar?.name || "공격자", 120);
            const enemyName = asSafeString(battle?.enemyName || job?.enemyName || enemyChar?.name || "수비자", 120);
            const myImageUrl = getBattleImageUrl(battle?.myImage) || getBattleImageUrl(job?.myImage);
            const enemyImageUrl = getBattleImageUrl(battle?.enemyImage) || getBattleImageUrl(job?.enemyImage);

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
                    myName,
                    enemyName,
                    winnerId: sideInfo.winnerId || null,
                    loserId: sideInfo.loserId || null,
                    winnerSide: sideInfo.winnerSide || null,
                    loserSide: sideInfo.loserSide || null,
                    battleLogs: safeLines(
                        Array.isArray(job?.battleContext?.logs) ? job.battleContext.logs : battle?.logs,
                        14,
                        320
                    ),
                    previewText: asSafeString(job?.battleContext?.previewText || battle?.previewText || "", 1800),
                    userPrompt: asSafeString(job?.userPromptRaw || "", 1200),
                    queuePrompt: asSafeString(job?.userPrompt || "", 2200),
                    characters: {
                        my: {
                            name: myName,
                            promptRefined: asSafeString(
                                myChar?.promptRefined || job?.battleContext?.promptRefined?.my || "",
                                1800
                            ),
                            fullStory: asSafeString(
                                myChar?.fullStory || myChar?.finalStory || job?.battleContext?.fullStory?.my || "",
                                2400
                            )
                        },
                        enemy: {
                            name: enemyName,
                            promptRefined: asSafeString(
                                enemyChar?.promptRefined || job?.battleContext?.promptRefined?.enemy || "",
                                1800
                            ),
                            fullStory: asSafeString(
                                enemyChar?.fullStory || enemyChar?.finalStory || job?.battleContext?.fullStory?.enemy || "",
                                2400
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

            const { modelKey, modelInfo } = resolveBattleModelInfo(job?.modelKey);

            const finalPrompt = buildReferenceLockedBattlePrompt({
                scenePrompt: promptResult.prompt,
                myName,
                enemyName,
                winnerSide: sideInfo.winnerSide,
                loserSide: sideInfo.loserSide,
                violenceLevel: promptResult.violenceLevel,
                negativePrompt: promptResult.negativePrompt,
                provider: modelInfo.provider
            });

            let buffer;

            if (modelInfo.provider === "gemini") {
                const [myRefImage, enemyRefImage] = await Promise.all([
                    fetchImageAsInlineData(myImageUrl, "my"),
                    fetchImageAsInlineData(enemyImageUrl, "enemy")
                ]);

                buffer = await generateBattleImageWithGemini(
                    {
                        prompt: finalPrompt,
                        aspectRatio: modelInfo.aspectRatio || "16:9",
                        references: [
                            {
                                ...myRefImage,
                                label: "FIRST",
                                name: myName,
                                role: sideInfo.winnerSide === "my" ? "winner" : sideInfo.loserSide === "my" ? "loser" : "fighter"
                            },
                            {
                                ...enemyRefImage,
                                label: "SECOND",
                                name: enemyName,
                                role: sideInfo.winnerSide === "enemy" ? "winner" : sideInfo.loserSide === "enemy" ? "loser" : "fighter"
                            }
                        ]
                    },
                    GEMINI_API_KEY.value()
                );
            } else {
                buffer = await generateBattleImageWithTogether(
                    {
                        model: modelInfo.model,
                        prompt: finalPrompt,
                        width: modelInfo.width,
                        height: modelInfo.height,
                        steps: modelInfo.steps,
                        guidance: modelInfo.guidance,
                        referenceImages: [myImageUrl, enemyImageUrl]
                    },
                    TOGETHER_KEY.value()
                );
            }

            const storagePath = job?.storage?.path || `battles/${battleId}/images/${jobId}.png`;
            const downloadToken = job?.storage?.downloadToken || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const bucketName = asSafeString(job?.storage?.bucket, 500);
            const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();

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
                    provider: modelInfo.provider,
                    model: modelInfo.model,
                    modelKey,
                    sceneType: promptResult.sceneType,
                    violenceLevel: promptResult.violenceLevel,
                    safetyScore: Number(promptResult.safetyScore || 0),
                    prompt: {
                        final: finalPrompt,
                        scene: promptResult.prompt,
                        negative: promptResult.negativePrompt || "",
                        reason: promptResult.reason || "",
                        referenceMode: modelInfo.provider === "together"
                            ? {
                                image1: myName,
                                image2: enemyName,
                                winnerSide: sideInfo.winnerSide || null,
                                loserSide: sideInfo.loserSide || null,
                                winnerStylePrimary: !!sideInfo.winnerSide,
                                poseReuseForbidden: true,
                                referenceInput: "reference_images"
                            }
                            : {
                                firstImage: myName,
                                secondImage: enemyName,
                                winnerSide: sideInfo.winnerSide || null,
                                loserSide: sideInfo.loserSide || null,
                                winnerStylePrimary: !!sideInfo.winnerSide,
                                poseReuseForbidden: true,
                                referenceInput: "inline_data"
                            },
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
                        modelKey,
                        costFrames: Number(job?.costFrames || job?.billing?.chargedFrames || 0) || null,
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
