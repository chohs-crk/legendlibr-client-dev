// functions/battle/maketarot.js (Vertex 버전)
const { VertexAI } = require("@google-cloud/vertexai");
const { SYSTEM_PROMPT, buildTarotPrompt } = require("./maketarot.prompt");

function getVertex() {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!projectId) throw new Error("GCP project id missing (GCLOUD_PROJECT / GCP_PROJECT).");

    // ✅ 2.5 계열 요구에 맞춰 us-central1
    const location = "us-central1";
    return new VertexAI({ project: projectId, location });
}

function extractTextFromVertexResponse(response) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts.map(p => p?.text || "").join("");
}

async function makeTarot({
    myIntro,
    enemyIntro,
    battleLog,
    winnerName,
    myOriginName,
    myRegionName,
    enemyOriginName,
    enemyRegionName
}) {
    const vertexAI = getVertex();

    // ✅ 타로는 창의성/표현력 때문에 flash 추천 (lite도 가능하지만 품질이 조금 떨어질 수 있음)
    const model = vertexAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
    });

    const userPrompt = buildTarotPrompt({
        myIntro,
        enemyIntro,
        battleLog,
        winnerName,
        myOriginName,
        myRegionName,
        enemyOriginName,
        enemyRegionName
    });

    const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "object",
                properties: {
                    myTarot: { type: "string" },
                    enemyTarot: { type: "string" }
                },
                required: ["myTarot", "enemyTarot"]
            },
            temperature: 0.8,
            maxOutputTokens: 2048
        },

        // ✅ Vertex에서도 safetySettings를 받는 경우가 많음(환경/버전에 따라 무시될 수 있음)
        // - 여기서 목적은 “불필요한 차단”을 완화하는 것
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
    });

    const response = result?.response;
    const candidate = response?.candidates?.[0];
    const text = extractTextFromVertexResponse(response);

    if (!candidate) throw new Error("TAROT_EMPTY_CANDIDATE");

    // finishReason은 SDK/환경마다 값이 달라질 수 있으니 방어적으로 처리
    const finishReason = candidate.finishReason;
    if (finishReason === "MAX_TOKENS") {
        throw new Error("TAROT_TRUNCATED");
    }

    console.log("[TAROT_RESULT_META]", {
        finishReason,
        textLen: text?.length || 0
    });

    if (!text) {
        throw new Error("TAROT_EMPTY_RESPONSE");
    }

    try {
        return JSON.parse(text.trim());
    } catch (e) {
        console.error("[TAROT_PARSE_ERROR] 원문:", text);
        throw new Error("TAROT_PARSE_FAIL");
    }
}

module.exports = { makeTarot };