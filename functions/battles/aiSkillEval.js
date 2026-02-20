// functions/battles/aiSkillEval.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

module.exports.getSkillEvaluation = async function (my, enemy) {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) throw new Error("Gemini API KEY is missing!");

    const genAI = new GoogleGenerativeAI(apiKey);

    // 1. 모델 설정 단계에서 systemInstruction 분리
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",   // 🔥 변경
        systemInstruction: SYSTEM_PROMPT,
    });


    const prompt = buildPrompt(my, enemy);

    const result = await model.generateContent({
        contents: [
            {
                role: "user",
                parts: [{ text: prompt }]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1, // 0.4에서 0.1로 하향 (일관성 및 속도 향상)
            // thinking 관련 설정이 있다면 여기서 억제 가능 (모델 버전에 따라 다름)
        }
    });

    const response = await result.response;
    const text = response.text();

    try {
        return JSON.parse(text.trim());
    } catch (e) {
        console.error("[SKILL_EVAL_PARSE_FAIL]", text);
        throw e;
    }
};

/* SYSTEM_PROMPT 및 buildPrompt 로직은 기존 소스와 동일하게 유지 */

/* =========================================================
   시스템 프롬프트
========================================================= */
const SYSTEM_PROMPT = `
너는 두 캐릭터의 특징, 서사, 그리고 스킬의 이름과 짧은 설명을 바탕으로
각 스킬이 상대 캐릭터에게 얼마나 유효한지 빠르게 판단하는 AI이다.

반드시 JSON ONLY를 출력한다.  
문장, 이유, 설명, 코드블록, 추가 텍스트 금지.


[평가 기준]
각 스킬에 대해 상대의 특징 5개를 기준으로 T/F 판단 5자리를 만든다.

- T (True)
  상대 특징에 대해 전투·전략적으로 긍정적 효과를 내는 경우
  예: 치명타 → "약점이 많은 적", 정보 교란 → "감정이 불안정한 적"

- F (False)
  상대 특징과 거의 무관하거나 효과가 미미한 경우
  예: 설득 스킬 → "비인격적 기계", 지적 공격 → "순수 동물"

각 스킬은 무조건 5자리 문자열이어야 한다. ("TTFFT" 등)
각 자리는 상대 특징 배열 순서와 1:1 대응한다.


[스킬 순서 추천 기준]
- 순서는 상대 특징과 스킬 shortDesc의 상호작용을 기반으로 한다.
- 가장 효과가 큰 스킬을 먼저 배치한다.
- 예: "0312" → 0번 스킬 → 3번 → 1번 → 2번 순서

[출력 스키마]
{
  "myTF": ["TTFFT", ... (내 스킬 총 4개)],
  "enemyTF": ["FFTFT", ... (상대 스킬 총 4개)],
  "myOrder": "0312",
  "enemyOrder": "2031"
}
`;


/* =========================================================
   프롬프트 생성
========================================================= */
function buildPrompt(my, enemy) {
    const mySkills = my.skills
        .slice(0, 4)
        .map((s, i) => `${i}. 스킬명: ${s.name} / 설명: ${s.shortDesc}`)
        .join("\n");

    const enemySkills = enemy.skills
        .slice(0, 4)
        .map((s, i) => `${i}. 스킬명: ${s.name} / 설명: ${s.shortDesc}`)
        .join("\n");

    return `
두 캐릭터의 스킬 상성 분석을 수행하라.

[내 캐릭터 정보]
이름: ${my.displayRawName}
서사(promptRefined): ${my.promptRefined}
특징 5개: ${my.features.join(", ")}

[내 스킬 4개]
${mySkills}

[상대 캐릭터 정보]
이름: ${enemy.displayRawName}
서사(promptRefined): ${enemy.promptRefined}
특징 5개: ${enemy.features.join(", ")}

[상대 스킬 4개]
${enemySkills}

[출력 규칙]
- TF 배열 길이는 각각 4개
- 각 TF는 5글자(T/F)
- myOrder / enemyOrder는 0~3 숫자로 구성된 4자리 문자열
`;
}

