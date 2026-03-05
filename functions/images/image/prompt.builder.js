"use strict";

const { STYLE_PRESETS, normalizeStyleKey } = require("./image.config");

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

/* =========================
   OpenAI: 프롬프트+점수 생성
========================= */
async function buildImagePromptAndScore(input, openaiKey, options = {}) {
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
- originId (string|null, optional)
- originBackground (string|null, optional)
- styleKey (string|null)
- modelKey (string)

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

    return JSON.parse(text);
}

/* =========================
   최종 프롬프트 렌더링
   - subject는 그대로 두고(background/composition/style만 보강)
========================= */
function buildFinalPrompt({ promptResult, format, jobStyleKey, userPrompt, modelInfo, originBackground }) {
    const normalizedFormat = format === "tags" ? "tags" : "sentences";

    function userSpecifiesCompositionPrompt(up) {
        if (typeof up !== "string") return false;
        const s = up.toLowerCase();
        if (!s.trim()) return false;

        const patterns = [
            /\b(full body|full-body|wide shot|long shot|establishing shot|close up|close-up|bust|portrait|headshot|upper body|half body|cowboy shot)\b/i,
            /\b(front view|side view|profile|three[- ]quarter|3\/?4|from behind|back view|over the shoulder)\b/i,
            /\b(low angle|high angle|bird'?s eye|top[- ]down|worm'?s eye|dutch angle|fisheye|pov|point of view|depth of field)\b/i,
            /(전신|반신|상반신|얼굴|클로즈업|정면|측면|옆모습|후면|뒷모습|구도|카메라|앵글|시점|원근|로우앵글|하이앵글|탑다운|버드아이|피사계심도)/
        ];
        return patterns.some((re) => re.test(up));
    }

    const sections = promptResult?.sections || {};

    // ✅ subject는 그대로 (요청대로)
    const subject = {
        tags: asTags(sections.subject?.tags),
        sentence: asSentence(sections.subject?.sentence)
    };

    // background / composition / style만 보강
    let background = {
        tags: asTags(sections.background?.tags),
        sentence: asSentence(sections.background?.sentence)
    };

    const compositionFromAI = {
        tags: asTags(sections.composition?.tags),
        sentence: asSentence(sections.composition?.sentence)
    };

    const aiStyle = {
        tags: asTags(sections.style?.tags),
        sentence: asSentence(sections.style?.sentence)
    };

    // ✅ 기본(클로즈업) 컴포지션 — "후순위(태그 뒤)" 로만 넣기 위해 별도 분리
    const defaultComposition = {
        tags: [
            // 🔥 강제 상반신 앵커
            "extreme close-up portrait",
            "head and shoulders only",
            "upper body only",
            "tight chest-up framing",
            "face fills most of the frame",
            "zoomed in on face",
            "large face in frame",
            "subject dominates entire canvas",
            "cropped below chest",
            "no legs visible",
            "no full body",
            "no distant character",
            "no small subject",
            "no wide shot",
            "no long shot"
        ],
        sentence:
            "Extreme close-up portrait of a single character, framed tightly from chest up. The face fills most of the frame and dominates the canvas. No full body, no distant shot, no wide framing."
    };
    const userWantsCustomComposition = userSpecifiesCompositionPrompt(userPrompt);

    // ✅ origin background(콤마 문자열) → 태그로 분해
    const originBgTags = splitCommaTags(originBackground);
    const originBgSentence = toOneSentence(originBackground);

    // ✅ 앵커 (인물 제외)
    // - origin background가 있으면 "simple background" 같은 강제 단순화를 줄여 충돌을 피함
    const BG_ANCHORS_BASE = [
        "background not overpowering subject",
        "soft blur background",
        "minimal clutter",
        "no text in background",
        "no logo"
    ];

    const BG_ANCHORS_SIMPLE = ["simple background", "clean shapes"];

    const BG_ANCHORS = originBgTags.length > 0 ? BG_ANCHORS_BASE : [...BG_ANCHORS_SIMPLE, ...BG_ANCHORS_BASE];

    // - "기본 구도(클로즈업)"은 후순위로 넣고, 여기서는 충돌이 적은 품질 앵커만 사용
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

    // ✅ 모델별 태그 상한 (과다 태그로 인한 흔들림 방지)
    const isTogether = modelInfo?.provider === "together";
    const isFlux =
        isTogether && typeof modelInfo?.model === "string" && modelInfo.model.toLowerCase().includes("flux");
    const isSdxl =
        isTogether &&
        typeof modelInfo?.model === "string" &&
        modelInfo.model.toLowerCase().includes("stable-diffusion-xl");

    // 기본 구도를 "후순위"로 추가하므로 comp 한도를 조금 상향
    const limits = isFlux
        ? { bg: 18, comp: 18, style: 28 }
        : isSdxl
            ? { bg: 14, comp: 16, style: 18 }
            : { bg: 14, comp: 16, style: 20 };

    // 1) background: origin background를 최우선(태그 앞)으로 삽입
    const bgAnchors = originBgTags.length > 0 ? [...originBgTags, ...BG_ANCHORS] : BG_ANCHORS;
    background.tags = enrichTags(background.tags, bgAnchors, limits.bg);
    if (originBgSentence) {
        background.sentence = [originBgSentence, background.sentence].filter(Boolean).join(" ");
    }

    // 2) composition:
    // - 유저가 구도를 명시한 경우: 기본(클로즈업)을 붙이지 않음
    // - 유저가 구도를 명시하지 않은 경우: AI composition이 있어도 "기본(클로즈업)"을 후순위로 붙임
    let compositionTags = userWantsCustomComposition
        ? uniq([...compositionFromAI.tags])
        : uniq([...COMP_ANCHORS_GENERAL, ...compositionFromAI.tags]);

    const useDefaultCompositionFallback = !userWantsCustomComposition;

    if (useDefaultCompositionFallback) {
        // ✅ 후순위: AI tags 뒤에 기본 구도 태그를 추가
        compositionTags = uniq([...compositionTags, ...defaultComposition.tags]);
    }

    // 태그가 길어져도 기본 구도 tail이 살아있도록 tail 보존
    if (useDefaultCompositionFallback) {
        const headKeep = 8; // 🔥 상반신 앵커 절대 유지
        const capped = compositionTags.slice(0, headKeep);

        const rest = compositionTags.slice(headKeep);
        const remaining = limits.comp - headKeep;

        compositionTags = [...capped, ...rest.slice(0, remaining)];
    } else {
        compositionTags = compositionTags.slice(0, limits.comp);
    }
    let compositionSentence = compositionFromAI.sentence;
    if (useDefaultCompositionFallback) {
        // ✅ 후순위: AI sentence 뒤에 기본 구도 sentence를 추가(또는 AI가 비면 기본만)
        compositionSentence = compositionSentence
            ? [compositionSentence, defaultComposition.sentence].filter(Boolean).join(" ")
            : defaultComposition.sentence;
    }

    const composition = { tags: compositionTags, sentence: compositionSentence };

    // 3) style preset 적용 (preset 우선)
    const normalizedStyleKey = normalizeStyleKey(jobStyleKey);
    const stylePreset = normalizedStyleKey ? STYLE_PRESETS[normalizedStyleKey] : null;

    let appliedStyle = stylePreset
        ? {
            tags: [...stylePreset.tags, ...aiStyle.tags.filter((t) => !stylePreset.tags.includes(t))],
            sentence: stylePreset.sentence
        }
        : aiStyle;

    appliedStyle.tags = enrichTags(appliedStyle.tags, STYLE_ANCHORS_2D, limits.style);

    // 최종 프롬프트 생성
    let tagsPrompt = "";
    let sentencePrompt = "";
    let finalPrompt = "";

    if (normalizedFormat === "tags") {
        // ✅ 모든 모델: style 관련 프롬프트를 가장 앞에
        // - FLUX는 기존처럼 composition을 style 다음에 두는 편이 안정적
        let allTags;

        if (isFlux) {
            allTags = [...appliedStyle.tags, ...composition.tags, ...subject.tags, ...background.tags];
        } else {
            allTags = [...appliedStyle.tags, ...subject.tags, ...background.tags, ...composition.tags];
        }

        tagsPrompt = joinTags(allTags);
        finalPrompt = tagsPrompt;
    } else {
        // ✅ sentences도 style을 첫 단락으로
        sentencePrompt = [appliedStyle.sentence, subject.sentence, background.sentence, composition.sentence]
            .filter(Boolean)
            .join("\n\n");
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
