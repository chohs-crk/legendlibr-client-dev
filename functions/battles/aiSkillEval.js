// functions/battle/ai/aiSkillEval.js

const fetch = require("node-fetch");
const functions = require("firebase-functions");

/* =========================================================
   🔥 TRPG 배틀용 스킬 상성 / 순서 분석 AI
   - 각 스킬마다 T/F 5개 평가
   - 전체 8개 스킬에 대해 배열로 반환
   - 스킬 추천 순서 문자열도 반환
========================================================= */

module.exports.getSkillEvaluation = async function (my, enemy) {
    const OPENAI_API_KEY =
        process.env.OPENAI_API_KEY ||
        (functions.config().openai && functions.config().openai.key);

    if (!OPENAI_API_KEY) {
        throw new Error("OpenAI API KEY is missing!");
    }

    const prompt = buildPrompt(my, enemy);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.15,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt },
            ],
        }),
    });

    const json = await res.json();

    let raw = json?.choices?.[0]?.message?.content || "{}";
    raw = raw.replace(/```json|```/g, "").trim();

    return JSON.parse(raw);
};

/* =========================================================
   시스템 프롬프트
========================================================= */
const SYSTEM_PROMPT = `
너는 두 캐릭터가 가진 특징(features), 서사(promptRefined), 스킬(shortDesc)을 바탕으로
각 스킬이 상대 캐릭터에게 긍정적인지(T) 부정적인지(F)를 5자리 문자열로 출력하는 분석 AI이다.

반드시 JSON ONLY를 출력한다.
문자, 설명, 이유, 코드블록 금지.

T/F 5자 기준:
- T = 상대에게 유리 / 상대를 효과적으로 공격 / 상대 성격과 약점에 잘 들어맞음
- F = 효과가 적음 / 잘 안 맞음 / 상대의 성격·특징·상황과 호응하지 않음

스킬 순서 추천:
- 스킬 shortDesc + 상대 특성 기반으로 추천
- 예: "0321" → 0번 스킬 → 3번 → 2번 → 1번

출력 스키마:
{
  "myTF": ["TTFFT", ... (내 8개 스킬)],
  "enemyTF": ["FFTFT", ... (상대 8개 스킬)],
  "myOrder": "0312",
  "enemyOrder": "2031"
}
`;

/* =========================================================
   프롬프트 생성
========================================================= */
function buildPrompt(my, enemy) {
    const mySkills = my.skills
        .map((s, i) => `${i}. ${s.name} - ${s.shortDesc}`)
        .join("\n");

    const enemySkills = enemy.skills
        .map((s, i) => `${i}. ${s.name} - ${s.shortDesc}`)
        .join("\n");

    return `
[내 캐릭터]
이름: ${my.displayRawName}
설명(promptRefined): ${my.promptRefined}
특징(features): ${my.features.join(", ")}

[내 스킬 목록]
${mySkills}

[상대 캐릭터]
이름: ${enemy.displayRawName}
설명(promptRefined): ${enemy.promptRefined}
특징(features): ${enemy.features.join(", ")}

[상대 스킬 목록]
${enemySkills}

[출력 규칙]
- 반드시 JSON만 출력
- T/F 분석은 스킬 shortDesc와 특징 기반
- myTF와 enemyTF의 길이는 각각 8개
- myOrder와 enemyOrder는 0~7 사이 숫자 4개로 구성된 문자열
    `;
}
