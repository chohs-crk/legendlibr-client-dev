// maketarot.js 수정본
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const { SYSTEM_PROMPT, buildTarotPrompt } = require("./maketarot.prompt");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

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
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) throw new Error("Gemini API KEY missing");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
            temperature: 0.8, // 창의성을 위해 살짝 높임
            maxOutputTokens: 2048, // 타로 이름에는 충분한 길이
        },
        // ✅ 안전 필터로 인해 끊기는 현상을 방지
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
    });

    // ✅ 결과 분석 및 로깅 개선
    const response = result.response;
    const text = response.text();
    const candidate = response.candidates?.[0];

    // 🔒 토큰 초과/비정상 종료 방어
    if (!candidate || candidate.finishReason === "MAX_TOKENS") {
        throw new Error("TAROT_TRUNCATED");
    }
    // 디버깅: 모델이 왜 멈췄는지 확인 (로그에서 finishReason 확인 필수)
    console.log("[TAROT_RESULT_META]", {
        finishReason: response.candidates[0].finishReason,
        textLen: text.length
    });

    try {
        // responseMimeType 사용 시 JSON 외의 텍스트가 섞이지 않으므로 바로 파싱
        return JSON.parse(text.trim());
    } catch (e) {
        console.error("[TAROT_PARSE_ERROR] 원문:", text);
        throw new Error("TAROT_PARSE_FAIL");
    }
}

module.exports = { makeTarot };
//✅