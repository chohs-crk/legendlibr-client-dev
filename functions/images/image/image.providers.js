"use strict";

const { DEFAULT_WIDTH, DEFAULT_HEIGHT } = require("./image.config");

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
                generationConfig: {
                    responseModalities: ["IMAGE"]
                }
            })
        }
    );

    const json = await res.json().catch(() => ({}));
    if (json.error) throw new Error(`GEMINI_API_ERROR: ${json.error.message}`);

    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
    if (!part) throw new Error("GEMINI_IMAGE_FAILED: No image data returned.");

    return Buffer.from(part.inlineData.data, "base64");
}

function getGeminiTextParts(json) {
    const parts = json?.candidates?.[0]?.content?.parts || [];
    return parts
        .map((p) => (typeof p?.text === "string" ? p.text.trim() : ""))
        .filter(Boolean);
}

function getGeminiImagePart(json) {
    const parts = json?.candidates?.[0]?.content?.parts || [];
    return parts.find((p) => p?.inlineData?.data) || null;
}

function buildBattlePromptParts(prompt, references, { simplified = false } = {}) {
    const safePrompt = typeof prompt === "string" ? prompt.trim() : "";
    const refs = Array.isArray(references) ? references.filter((ref) => ref?.data && ref?.mimeType) : [];

    const parts = [];

    if (simplified) {
        if (refs[0]) {
            parts.push({ text: `Reference image 1 is ${refs[0]?.name || "character one"}. Never swap this identity.` });
            parts.push({ inlineData: { mimeType: refs[0].mimeType, data: refs[0].data } });
        }
        if (refs[1]) {
            parts.push({ text: `Reference image 2 is ${refs[1]?.name || "character two"}. Never swap this identity.` });
            parts.push({ inlineData: { mimeType: refs[1].mimeType, data: refs[1].data } });
        }
        parts.push({
            text:
                `${safePrompt} Generate exactly one image. Keep both characters recognizable from their own reference images. ` +
                `Do not copy the exact original pose or crop from the references. Re-stage them into a new dynamic battle moment.`
        });
        return parts;
    }

    parts.push({
        text:
            "You will receive two labeled reference images for a single battle illustration. Keep the identities attached to each image fixed and never swap them."
    });

    refs.forEach((ref, index) => {
        const ordinal = ref?.label || `IMAGE_${index + 1}`;
        const role = ref?.role ? ` This character's battle role is ${ref.role}.` : "";
        parts.push({
            text: `${ordinal} attached image: ${ref?.name || `character ${index + 1}`}.${role} Use this image as that character's exact visual identity reference.`
        });
        parts.push({
            inlineData: {
                mimeType: ref.mimeType,
                data: ref.data
            }
        });
    });

    parts.push({ text: safePrompt });
    return parts;
}

async function requestBattleImage(parts, aspectRatio, geminiKey) {
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
                contents: [{ parts }],
                generationConfig: {
                    responseModalities: ["Image"],
                    imageConfig: {
                        aspectRatio
                    }
                }
            })
        }
    );

    const json = await res.json().catch(() => ({}));
    if (json.error) throw new Error(`GEMINI_API_ERROR: ${json.error.message}`);

    const imagePart = getGeminiImagePart(json);
    if (imagePart?.inlineData?.data) {
        return {
            ok: true,
            buffer: Buffer.from(imagePart.inlineData.data, "base64"),
            textParts: getGeminiTextParts(json)
        };
    }

    return {
        ok: false,
        textParts: getGeminiTextParts(json)
    };
}

/* =========================
   Gemini 배틀 이미지 생성
   - 텍스트 + 참조 이미지 2장 멀티모달 입력
   - 캐릭터 이미지 생성 로직과 분리된 battle 전용 보강
========================= */
async function generateBattleImageWithGemini(
    {
        prompt,
        aspectRatio = "16:9",
        references = []
    },
    geminiKey
) {
    const refs = Array.isArray(references) ? references.filter((ref) => ref?.data && ref?.mimeType) : [];
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        throw new Error("GEMINI_BATTLE_INPUT_EMPTY");
    }
    if (!refs.length) {
        throw new Error("GEMINI_BATTLE_REFERENCE_EMPTY");
    }

    const firstAttempt = await requestBattleImage(buildBattlePromptParts(prompt, refs), aspectRatio, geminiKey);
    if (firstAttempt.ok) return firstAttempt.buffer;

    const fallbackAttempt = await requestBattleImage(
        buildBattlePromptParts(prompt, refs, { simplified: true }),
        aspectRatio,
        geminiKey
    );
    if (fallbackAttempt.ok) return fallbackAttempt.buffer;

    const firstText = firstAttempt.textParts.join(" ").slice(0, 500) || "EMPTY";
    const fallbackText = fallbackAttempt.textParts.join(" ").slice(0, 500) || "EMPTY";
    throw new Error(
        `GEMINI_BATTLE_IMAGE_FAILED: No image data returned. attempt1_text=${firstText} fallback_text=${fallbackText}`
    );
}

/* =========================
   Together 이미지 생성
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

    if (negativePrompt && typeof negativePrompt === "string") body.negative_prompt = negativePrompt;

    const res = await fetch("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${togetherKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || json?.message || "TOGETHER_IMAGE_FAILED");

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

async function generateBattleImageWithTogether(
    { model, prompt, width, height, steps, guidance, seed, referenceImages = [] },
    togetherKey
) {
    const refs = Array.isArray(referenceImages)
        ? referenceImages.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
        : [];

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        throw new Error("TOGETHER_BATTLE_INPUT_EMPTY");
    }

    if (refs.length < 2) {
        throw new Error("TOGETHER_BATTLE_REFERENCE_EMPTY");
    }

    const body = {
        model,
        prompt,
        width: width ?? DEFAULT_WIDTH,
        height: height ?? DEFAULT_HEIGHT,
        response_format: "base64",
        output_format: "png",
        n: 1,
        reference_images: refs
    };

    if (typeof steps === "number") body.steps = steps;
    if (typeof guidance === "number") body.guidance_scale = guidance;
    if (typeof seed === "number") body.seed = seed;

    const res = await fetch("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${togetherKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || json?.message || "TOGETHER_BATTLE_IMAGE_FAILED");

    const b64 = json?.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, "base64");

    const url = json?.data?.[0]?.url;
    if (url) {
        const imgRes = await fetch(url);
        if (!imgRes.ok) throw new Error("TOGETHER_BATTLE_IMAGE_URL_FETCH_FAILED");
        const arr = await imgRes.arrayBuffer();
        return Buffer.from(arr);
    }

    throw new Error("TOGETHER_BATTLE_IMAGE_FAILED: No image data returned.");
}

module.exports = {
    generateImageWithGemini,
    generateBattleImageWithGemini,
    generateImageWithTogether,
    generateBattleImageWithTogether
};
