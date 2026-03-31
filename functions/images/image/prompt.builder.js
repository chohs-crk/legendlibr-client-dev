"use strict";

const { STYLE_PRESETS, normalizeStyleKey, getModelPromptPolicy } = require("./image.config");

/* =========================
   utils
========================= */
function stripJsonFence(s) {
    return (s || "").replace(/```json|```/g, "").trim();
}

function asTags(v) {
    return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

function asSentence(v) {
    return typeof v === "string" ? v.trim() : "";
}

function joinTags(list) {
    return list.map((s) => s.trim()).filter(Boolean).join(", ");
}

function uniq(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) {
        const s = String(x || "").trim();
        if (!s) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
    }
    return out;
}

function enrichTags(baseTags, anchorTags, maxCount) {
    const merged = uniq([...(anchorTags || []), ...(baseTags || [])]);
    return typeof maxCount === "number" ? merged.slice(0, maxCount) : merged;
}

/**
 * Split a comma-separated background string into tags.
 * - Keeps phrases intact (commas are the only delimiter).
 */
function splitCommaTags(v) {
    if (typeof v !== "string") return [];
    return v
        .split(",")
        .map((s) => String(s || "").trim())
        .filter(Boolean);
}

function toOneSentence(v) {
    if (typeof v !== "string") return "";
    const s = v.trim().replace(/\s+/g, " ");
    if (!s) return "";
    return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * Cap a list while preserving the last N items (useful when we want "low-priority tail tags"
 * to still be included even if the list is long).
 */
function capPreservingTail(list, maxCount, tailKeep = 0) {
    if (!Array.isArray(list)) return [];
    if (!Number.isFinite(maxCount) || maxCount <= 0) return [];
    if (list.length <= maxCount) return list;

    const tk = Math.max(0, Math.min(Number(tailKeep) || 0, maxCount));
    if (tk === 0) return list.slice(0, maxCount);

    const headKeep = maxCount - tk;
    return [...list.slice(0, headKeep), ...list.slice(list.length - tk)];
}

function splitSentences(v) {
    if (typeof v !== "string") return [];
    return (
        v
            .replace(/\s+/g, " ")
            .match(/[^.!?]+[.!?]?/g)
            ?.map((s) => s.trim())
            .filter(Boolean) || []
    );
}

function capSentenceCount(v, maxCount = 1) {
    const parts = splitSentences(v);
    return parts.slice(0, Math.max(1, maxCount)).join(" ");
}

function capTagList(v, maxCount) {
    return uniq(asTags(v)).slice(0, Math.max(0, Number(maxCount) || 0));
}

/* =========================
   OpenAI: 프롬프트+점수 생성
========================= */
async function buildImagePromptAndScore(input, openaiKey, options = {}) {
    const format = options?.format === "tags" ? "tags" : "sentences";
    const modelPolicy = getModelPromptPolicy(input?.modelKey);

    const tagLimits = modelPolicy.openai.tags;
    const sentencesPerSection = modelPolicy.openai.sentencesPerSection;

    const outputRules =
        format === "tags"
            ? `
[Output formats]
You MUST output ONLY:
- tags: Flux-style prompting (short phrases, NOT full sentences)
  - Each tag is 1~5 words, English only
  - No commas inside a tag
  - subject: max ${tagLimits.subject} tags
  - background: max ${tagLimits.background} tags
  - composition: max ${tagLimits.composition} tags
  - style: max ${tagLimits.style} tags
  - negative: max ${tagLimits.negative} tags

Do NOT output any "sentence" fields anywhere in the JSON.
`
            : `
[Output formats]
You MUST output ONLY:
- sentence: sentence-style prompting (English sentences)
  - max ${sentencesPerSection} sentence per section
  - Keep it concise and visual

Do NOT output any "tags" fields anywhere in the JSON.
`;

    const outputSchema =
        format === "tags"
            ? `
{
  "subjectType": "human|animal|creature|object|abstract|environment",
  "hasExplicitPose": true,
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
  "hasExplicitPose": true,
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
- originId (string|null, optional)
- originBackground (string|null, optional)
- styleKey (string|null)
- modelKey (string)

[Priority]
- userPrompt is the PRIMARY source of visual instruction.
- promptRefined and fullStory are REFERENCE ONLY.
- Use promptRefined and fullStory only to preserve identity, consistency, and story flavor.
- Do NOT let promptRefined or fullStory override explicit visual directions from userPrompt.
- If userPrompt is empty or too weak, you may minimally borrow from promptRefined.

[Pose Detection]
Set "hasExplicitPose" to true only if userPrompt explicitly describes:
- pose or posture (standing, sitting, kneeling, lying, crouching, running, etc.)
- facing direction or body orientation (front view, side view, profile, back view, looking over shoulder, turning back, etc.)
- clear body action or placement that determines pose

Set it to false for:
- close-up / portrait / upper body / bust shot only
- mood only
- outfit only
- lighting only
- vague aesthetic wording only

[Framing]
The character is the main focus.
Keep close shot / portrait emphasis strong even when hasExplicitPose is true.
Background must remain secondary.

[FitScore]
fitscore은 유저가 입력한 캐릭터의 외형 묘사가
캐릭터의 스토리와 어울리는지를 어울릴수록 높은 점수, 0-100점 사이로 준다.

[Safety Rules – Strict Interpretation]
Only score high (80+) if:
- Explicit sexual acts
- Nudity described
- Minor involved
- Graphic violence
- Hate or illegal content

Do NOT raise safetyScore for:
- Neutral adult female
- Sitting pose
- Clothing description
- Non-sexual body references

[Goal]
Main subject must be visual focus.
If originBackground is provided, prefer it as the primary background direction.
Keep the background secondary to the subject (no crowd, no text, no logos).
Do NOT force a human if request is not about a person.

[Style Key Handling]
- If styleKey is provided, treat it as a HIGH-PRIORITY style preset explicitly chosen by the user.
- The style section MUST strongly reflect styleKey in rendering approach, palette, lighting mood, and finish.
- Do not water down styleKey because of promptRefined or fullStory.
- If userPrompt is vague, styleKey should dominate the style direction.
${outputRules}

[Sections]
subject, background, composition, style

[Strict Rules]
- English only
- JSON only

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
            model: "gpt-5-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(input) }
            ]
        })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || "OPENAI_PROMPT_FAILED");

    const text = stripJsonFence(json?.choices?.[0]?.message?.content);
    if (!text) throw new Error("OPENAI_EMPTY_RESPONSE");

    const parsed = JSON.parse(text);

    return {
        ...parsed,
        usage: json?.usage
            ? {
                promptTokens: Number(json.usage.prompt_tokens || 0),
                completionTokens: Number(json.usage.completion_tokens || 0),
                totalTokens: Number(json.usage.total_tokens || 0)
            }
            : null
    };
}

/* =========================
   최종 프롬프트 렌더링
   - subject는 그대로 두고(background/composition/style만 보강)
========================= */
function buildFinalPrompt({ promptResult, format, jobStyleKey, userPrompt, modelInfo, originBackground, modelKey }) {
    const normalizedFormat = format === "tags" ? "tags" : "sentences";

    function userSpecifiesPosePrompt(up) {
        if (typeof up !== "string") return false;
        const s = up.toLowerCase();
        if (!s.trim()) return false;

        const patterns = [
            /\b(standing|sitting|seated|kneeling|lying|reclining|crouching|squatting|walking|running|jumping|leaning|raising\s+hand|arms\s+crossed|hands\s+in\s+pockets)\b/i,
            /\b(front[- ]facing|front view|side view|profile|three[- ]quarter|3\/?4 view|from behind|back view|looking over shoulder|turning back|turned away|facing left|facing right)\b/i,
            /(서 있|앉아|앉은|무릎|눕|엎드|쪼그|달리|걷|기대|정면|측면|옆모습|후면|뒷모습|뒤돌|어깨너머|고개를 돌|포즈|자세)/
        ];
        return patterns.some((re) => re.test(s));
    }

    const sections = promptResult?.sections || {};
    const modelPolicy = getModelPromptPolicy(modelKey);
    const limits = modelPolicy.final;

    const subject = {
        tags: capTagList(sections.subject?.tags, limits.subject),
        sentence: capSentenceCount(asSentence(sections.subject?.sentence), 1)
    };

    let background = {
        tags: capTagList(sections.background?.tags, limits.background),
        sentence: capSentenceCount(asSentence(sections.background?.sentence), 1)
    };

    const compositionFromAI = {
        tags: capTagList(sections.composition?.tags, limits.composition),
        sentence: capSentenceCount(asSentence(sections.composition?.sentence), 1)
    };

    const aiStyle = {
        tags: capTagList(sections.style?.tags, limits.style),
        sentence: capSentenceCount(asSentence(sections.style?.sentence), 1)
    };

    const closeShotComposition = {
        tags: [
            "close-up portrait",
            "upper body framing",
            "chest-up composition",
            "single character focus",
            "subject fills most of frame",
            "face clearly visible"
        ],
        sentence:
            "Close-up portrait framing with upper-body emphasis. The character fills most of the frame and remains the clear visual focus."
    };

    const defaultPoseFallback = {
        tags: ["standing pose", "front-facing pose", "upright posture"],
        sentence: "Default pose is standing, front-facing, and upright."
    };

    const hasExplicitPose =
        typeof promptResult?.hasExplicitPose === "boolean"
            ? promptResult.hasExplicitPose
            : userSpecifiesPosePrompt(userPrompt);

    const originBgTags = splitCommaTags(originBackground);
    const originBgSentence = toOneSentence(originBackground);

    const BG_ANCHORS_BASE = [
        "background not overpowering subject",
        "soft blur background",
        "minimal clutter",
        "no text in background",
        "no logo"
    ];

    const BG_ANCHORS_SIMPLE = ["simple background", "clean shapes"];
    const BG_ANCHORS = originBgTags.length > 0 ? BG_ANCHORS_BASE : [...BG_ANCHORS_SIMPLE, ...BG_ANCHORS_BASE];

    const COMP_ANCHORS_GENERAL = [
        "single subject focus",
        "center composition",
        "clear silhouette",
        "sharp focus on face",
        "face clearly visible"
    ];

    const STYLE_ANCHORS_2D = [
        "flat 2D illustration",
        "bold outlines",
        "thick clean lineart",
        "cel shading",
        "flat shading",
        "solid color blocks",
        "illustrated style",
        "no photorealism",
        "no realistic skin",
        "no realistic lighting"
    ];

    const STYLE_PRESET_FORCE = {
        default: {
            tags: ["premium character key art", "elegant fantasy portrait", "soft luminous finish"],
            sentence: "The selected default style should clearly dominate the overall look as a polished, elegant fantasy game portrait."
        },
        darkfantasy: {
            tags: ["grim gothic mood", "ominous magical atmosphere", "shadow-heavy fantasy aesthetic"],
            sentence: "The selected style must read unmistakably as dark fantasy, with ominous mood, deep shadow, and gothic intensity."
        },
        pastel: {
            tags: ["airy pastel mood", "bright delicate palette", "soft dreamy finish"],
            sentence: "The selected style must read unmistakably as pastel, with an airy, delicate, dreamy tone across the whole image."
        },
        cyberpunk: {
            tags: ["neon cyberpunk mood", "high-tech night glow", "electric futuristic finish"],
            sentence: "The selected style must read unmistakably as cyberpunk, with neon glow, futuristic nightlife energy, and vivid electronic contrast."
        },
        anime: {
            tags: ["anime key visual look", "expressive anime rendering", "vibrant cel-finished illustration"],
            sentence: "The selected style must read unmistakably as polished Japanese-anime-inspired key visual art."
        }
    };

    const isTogether = modelInfo?.provider === "together";
    const isFlux =
        isTogether && typeof modelInfo?.model === "string" && modelInfo.model.toLowerCase().includes("flux");

    // 1) background: origin background를 최우선(태그 앞)으로 삽입
    const bgAnchors = originBgTags.length > 0 ? [...originBgTags, ...BG_ANCHORS] : BG_ANCHORS;
    background.tags = enrichTags(background.tags, bgAnchors, limits.background);
    if (originBgSentence) {
        background.sentence = [originBgSentence, background.sentence].filter(Boolean).join(" ");
        background.sentence = capSentenceCount(background.sentence, 1);
    }

    // 2) composition:
    // - 클로즈샷 계열은 항상 유지
    // - pose 명시가 없을 때만 기본 포즈를 추가
    let compositionTags = uniq([
        ...COMP_ANCHORS_GENERAL,
        ...closeShotComposition.tags,
        ...compositionFromAI.tags
    ]);

    if (!hasExplicitPose) {
        compositionTags = uniq([...compositionTags, ...defaultPoseFallback.tags]);
    }

    compositionTags = capPreservingTail(
        compositionTags,
        limits.composition,
        !hasExplicitPose ? defaultPoseFallback.tags.length : 0
    );

    let compositionSentence = [closeShotComposition.sentence, capSentenceCount(compositionFromAI.sentence, 1)]
        .filter(Boolean)
        .join(" ");

    if (!hasExplicitPose) {
        compositionSentence = [compositionSentence, defaultPoseFallback.sentence].filter(Boolean).join(" ");
    }

    compositionSentence = capSentenceCount(compositionSentence, 3);

    const composition = { tags: compositionTags, sentence: compositionSentence };

    // 3) style preset 적용 (preset 우선)
    const normalizedStyleKey = normalizeStyleKey(jobStyleKey);
    const stylePreset = normalizedStyleKey ? STYLE_PRESETS[normalizedStyleKey] : null;

    const stylePresetForce = normalizedStyleKey ? STYLE_PRESET_FORCE[normalizedStyleKey] || null : null;

    let appliedStyle = stylePreset
        ? {
            tags: [
                ...(stylePresetForce?.tags || []),
                ...stylePreset.tags,
                ...aiStyle.tags.filter((t) => !stylePreset.tags.includes(t))
            ],
            sentence: [stylePreset.sentence, stylePresetForce?.sentence].filter(Boolean).join(" ")
        }
        : aiStyle;

    appliedStyle.tags = enrichTags(appliedStyle.tags, STYLE_ANCHORS_2D, limits.style);
    appliedStyle.sentence = capSentenceCount(appliedStyle.sentence, stylePresetForce ? 2 : 1);

    // 최종 프롬프트 생성
    let tagsPrompt = "";
    let sentencePrompt = "";
    let finalPrompt = "";

    if (normalizedFormat === "tags") {
        let allTags;

        if (isFlux) {
            allTags = [...appliedStyle.tags, ...composition.tags, ...subject.tags, ...background.tags];
        } else {
            allTags = [...appliedStyle.tags, ...subject.tags, ...background.tags, ...composition.tags];
        }

        tagsPrompt = joinTags(allTags);
        finalPrompt = tagsPrompt;
    } else {
        sentencePrompt = [appliedStyle.sentence, subject.sentence, background.sentence, composition.sentence]
            .filter(Boolean)
            .join("\n\n");
        finalPrompt = sentencePrompt;
    }

    const negative = {
        tags: capTagList(promptResult?.negative?.tags, limits.negative),
        sentence: capSentenceCount(asSentence(promptResult?.negative?.sentence), 1)
    };

    return {
        format: normalizedFormat,
        finalPrompt,
        promptBundle: {
            language: "en",
            subjectType: promptResult?.subjectType || "unknown",
            analysis: {
                hasExplicitPose
            },
            style: {
                source: stylePreset ? "preset" : "ai",
                presetKey: stylePreset ? normalizedStyleKey : null,
                ai: aiStyle,
                applied: appliedStyle
            },
            sections: { subject, background, composition },
            negative,
            rendered: {
                tags: tagsPrompt,
                sentences: sentencePrompt
            },
            origin: {
                background: originBackground || null
            }
        }
    };
}

module.exports = {
    buildImagePromptAndScore,
    buildFinalPrompt
};
