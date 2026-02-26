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
function buildFinalPrompt({ promptResult, format, jobStyleKey, userPrompt, modelInfo }) {
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

    // ✅ 인물(subject)은 그대로 (요청대로)
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
    const compositionEmpty = compositionFromAI.tags.length === 0 && !compositionFromAI.sentence;

    let composition = compositionEmpty
        ? userWantsCustomComposition
            ? { tags: [], sentence: "" }
            : defaultComposition
        : compositionFromAI;

    const aiStyle = {
        tags: asTags(sections.style?.tags),
        sentence: asSentence(sections.style?.sentence)
    };

    const normalizedStyleKey = normalizeStyleKey(jobStyleKey);
    const stylePreset = normalizedStyleKey ? STYLE_PRESETS[normalizedStyleKey] : null;

    let appliedStyle = stylePreset
        ? {
            tags: [...stylePreset.tags, ...aiStyle.tags.filter((t) => !stylePreset.tags.includes(t))],
            sentence: stylePreset.sentence
        }
        : aiStyle;

    // ✅ 인물 제외 앵커
    const BG_ANCHORS = [
        "simple background",
        "background not overpowering subject",
        "soft blur background",
        "clean shapes",
        "minimal clutter",
        "no text in background",
        "no logo"
    ];

    const COMP_ANCHORS = [
        "single subject focus",
        "center composition",
        "clear silhouette",
        "subject separated from background",
        "sharp focus on subject",
        "portrait framing",
        "balanced composition"
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

    const limits = isFlux
        ? { bg: 16, comp: 16, style: 28 } // FLUX: style은 조금 더 허용 (앞에 배치)
        : isSdxl
            ? { bg: 12, comp: 12, style: 18 } // SDXL: 과다 태그 금지
            : { bg: 12, comp: 12, style: 20 };

    background.tags = enrichTags(background.tags, BG_ANCHORS, limits.bg);
    composition.tags = enrichTags(composition.tags, COMP_ANCHORS, limits.comp);
    appliedStyle.tags = enrichTags(appliedStyle.tags, STYLE_ANCHORS_2D, limits.style);

    // 최종 프롬프트 생성
    let tagsPrompt = "";
    let sentencePrompt = "";
    let finalPrompt = "";

    if (normalizedFormat === "tags") {
        let allTags;

        if (isFlux) {
            // 🔥 FLUX: 스타일을 맨 앞에 (고정력 ↑)
            allTags = [...appliedStyle.tags, ...subject.tags, ...composition.tags, ...background.tags];
        } else {
            // SDXL/기타: subject 중심 + 마지막에 스타일
            allTags = [...subject.tags, ...background.tags, ...composition.tags, ...appliedStyle.tags];
        }

        tagsPrompt = joinTags(allTags);
        finalPrompt = tagsPrompt;
    } else {
        sentencePrompt = [subject.sentence, background.sentence, composition.sentence, appliedStyle.sentence]
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
            }
        }
    };
}

module.exports = {
    buildImagePromptAndScore,
    buildFinalPrompt
};
