// functions/battle/ai/battleNarrationPrompt.js

/* =========================================================
   🔥 시스템 프롬프트
========================================================= */
function trimRegionDetail(text) {
    if (!text) return "";

    if (text.length <= 150) return text;

    let cut = 150;

    for (let i = 150; i < text.length; i++) {
        const ch = text[i];
        const prev = text[i - 1];

        const isEnd =
            (ch === "." || ch === "?" || ch === "!") &&
            prev !== ".";

        if (isEnd) {
            cut = i + 1;
            break;
        }
    }

    return text.slice(0, cut).trim();
}

const SYSTEM_PROMPT = `
너는 전투 로그를 작성하는 서사 AI이다.

[절대 규칙]
- user가 지정한 승자를 절대 위반하지 마라.
- 수치(데미지, HP, 계산식 등)를 직접 언급하지 마라.
- 반복 표현을 피하라.
- 구조를 설명하지 마라.
- 도입부/중반부/결말부 같은 표현 금지.
- "충돌했다", "시작되었다", "끝났다", "예고했다", 
  "흐름이 바뀌었다" 같은 전형적 문장 금지.
-유저 프롬프트의 지시문을 바탕으로 캐릭터에 어울리게 재창작하여 상황을 작성해야 한다.

[문체 규칙]
- 하나의 단편 소설처럼 600~800자.
- 인물의 감정선과 행동을 중심으로 장면 묘사.
- 원인과 동기를 직접 서술하라.
- 모호한 서술 금지.
- 지역 분위기를 재해석하여 녹여라.
- 두 지역 중 하나의 배경에서 전투하거나 혹은 별개의 공간을 배경으로 해도 된다.

[과거 회상 규칙]
- 캐릭터의 과거(fullStory)는 그대로 사용하지 마라.
- 사건을 재해석하여 장면 속 회상으로 녹여라.
- 요약하거나 복붙하지 말고 감정과 상황을 중심으로 재창작하라.

[지역 규칙]
- region은 캐릭터의 탄생 배경이다.
- 두 캐릭터의 출신 배경 대비를 장면에 자연스럽게 반영하라.
- 지역 설명을 그대로 복사하지 말 것.

[강조 규칙]
- 캐릭터 이름, 지역, 핵심 개념은 **강조** 형식 사용.
- 대사는 반드시 §대사§ 형식.
- 스킬은 반드시 『스킬명』 형식.

[스킬 규칙]
- 각 캐릭터는 최대 3개 스킬을 사용한다.
- 스킬 이름과 긴 설명이 들어간 것에 대해선 그 스킬 설명을 그대로 서술하지 말고, 스킬로 인한 결과를 생각해 창작할 것.
- 유저 프롬프트에 언급된 스킬 이름은 반드시 강조 규칙대로 서술한다.

[대사 규칙]
- 대사가 주어진 경우에만 §형식§ 사용.
- 대사가 없는 캐릭터는 절대 말하지 않는다.

[대사 스타일 규칙]
- 대사가 존재하는 캐릭터는 제공된 말투 지침을 반영하라.
- 말투 지침이 제공되지 않은 인물은 말하지 않는다.

[결말 규칙]
- 승패는 분명히 묘사하라.
- 승패 확정 문장 끝에 반드시 && 삽입.
- 최종 승자는 반드시 유저 프롬프트의 [전투 전개 조건] 속 최종 승자이다. 이를 위반할 시 실패로 간주한다.

규칙 위반 금지.
- 반드시 600자 이상 800자 이하의 실제 글자 수로 작성하라.
- 토큰 기준이 아닌 실제 한글 문자 길이 기준이다.

`;



/* =========================================================
   🔥 유저 프롬프트 생성
========================================================= */

function buildUserPrompt({
    my,
    enemy,
    myOriginName,
    enemyOriginName,
    mySkills,
    enemySkills,
    myTop2Idx,
    enemyTop2Idx,
    openingType,
    midResultType,
    winnerName
})
 {

    return `
[도입 설정]
**${my.displayRawName}**와(과) **${enemy.displayRawName}** 사이에서 ${openingType}
- 오프닝은 설명하지 말고 장면으로 시작할 것.
- 두 인물의 출신 지역 대비를 자연스럽게 암시할 것.

────────────────────────

[${my.displayRawName} 기본 정보]
이름: **${my.displayRawName}**
출신 세계관: **${myOriginName}**
출신 지역: **${my.region || "미지"}**
-세계관 속 지역이 존재함
지역 설명 참고:
${trimRegionDetail(my.regionDetail || "")}


캐릭터 소개 및 특징:
${my.promptRefined}

회상 재해석 자료, 이전 스토리:
${(my.fullStory || "")}

${my.canSpeak && my.speechStyle ? `
말투 참고 지침:
${my.speechStyle}
- 대사가 있을 경우 §형식§ 사용
- 말투 지침을 직접 설명하지 말 것
` : ""}

행동 흐름 지침:

${mySkills.map((skill, i) => {

    const isMajor =
        !Array.isArray(myTop2Idx) || myTop2Idx.includes(i);



    if (isMajor) {
        return `- 『${skill.name}』을 사용해 ${skill.longDesc}`;
    } else {
        return `- ${skill.shortDesc}`;
    }

}).join("\n")}
- 위 순서대로 스킬을 사용한 내용을 작성할 것.
- 행동의 자연스러운 흐름 속에 녹여 서술할 것.
- 스킬 이름이 포함된 긴 설명을 그대로 복붙하지 말고 결과 중심으로 재창작.
- 짧은 설명은 일부 변형해 행동처럼 자연스럽게 녹일 것.

────────────────────────

[${enemy.displayRawName} 기본 정보]
이름: **${enemy.displayRawName}**
출신 세계관: **${enemyOriginName}**
출신 지역: **${enemy.region || "미지"}**
캐릭터 소개 및 특징:
${trimRegionDetail(enemy.regionDetail || "")}


성격 및 존재감:
${enemy.promptRefined}

회상 재해석 자료, 이전 스토리:
${(enemy.fullStory || "")}

${enemy.canSpeak && enemy.speechStyle ? `
말투 참고 지침:
${enemy.speechStyle}
- 대사가 있을 경우 §형식§ 사용
- 말투 지침을 직접 설명하지 말 것
` : ""}

행동 흐름 지침:

${enemySkills.map((skill, i) => {

    const isMajor =
        !Array.isArray(enemyTop2Idx) || enemyTop2Idx.includes(i);


    if (isMajor) {
        return `- 『${skill.name}』을 사용해 ${skill.longDesc}`;
    } else {
        return `- ${skill.shortDesc}`;
    }

}).join("\n")}


- 위 순서대로 스킬을 사용한 내용을 작성할 것.
- 행동의 자연스러운 흐름 속에 녹여 서술할 것.
- 스킬 이름이 포함된 긴 설명을 그대로 복붙하지 말고 결과 중심으로 재창작.
- 짧은 설명은 일부 변형해 행동처럼 자연스럽게 녹일 것.

────────────────────────

[전투 전개 조건]
- 중반 전개 분위기: ${midResultType}
- 최종 승자: **${winnerName}**

────────────────────────

[작성 시 반드시 지킬 것]
- 600~800자 분량
- 하나의 단편 서사 구조
- 구조 설명 금지
- 진부한 표현 금지
- 실제 수치 언급 금지
- 감정선과 행동 중심 묘사
- 과거는 회상 장면으로 재해석
- 지역은 탄생 배경으로서 대비되게 반영
- 결말 확정 문장 끝에 반드시 && 삽입
`;
}



/* =========================================================
   🔥 판정 계산
========================================================= */

function evaluateTurnDiff(diff) {
    if (diff < 10) return "서로 쉽게 물러서지 않는 팽팽한 대치였다.";
    if (diff < 40) return "한쪽이 점차 주도권을 움켜쥐는 양상이었다.";
    return "일방적으로 흐름이 기울어 버린 국면이었다.";
}


function evaluateBattleFlow(turnLogs) {

    if (!turnLogs || turnLogs.length === 0) return "호각";

    const t1 = Math.abs(
        turnLogs[0].my.totalDmg - turnLogs[0].enemy.totalDmg
    );

    const last = turnLogs[turnLogs.length - 1];

    const t3 = Math.abs(
        last.my.hpAfter - last.enemy.hpAfter
    );

    const firstResult = evaluateTurnDiff(t1);
    const lastResult = evaluateTurnDiff(t3);

    if (firstResult !== lastResult)
        return "극적인 역전극으로 승리를 뒤집었다.";

    return lastResult;
}

function pickOpening() {

    const candidates = [
        "두 사람 사이에 오래전부터 봉인되지 못한 문제가 다시 떠올랐다.",
        "한쪽의 선택이 다른 한쪽의 명예를 건드렸다.",
        "잊히지 않은 약속이 오늘에서야 대가를 요구했다.",
        "침묵으로 묻어 두었던 진실이 서로의 눈빛에서 드러났다.",
        "각자의 세계에서 지켜온 신념이 정면으로 맞섰다.",
        "과거의 선택 하나가 지금 이 자리로 두 사람을 이끌었다."
    ];

    // 30% 확률로 AI가 직접 오프닝 생성
    if (Math.random() < 0.3) {
        return "__AI_GENERATE__";
    }

    // 2개 랜덤 선택
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const pick2 = shuffled.slice(0, 2);

    // 더 긴 문장 선택 (품질 가중)
    return pick2.sort((a, b) => b.length - a.length)[0];
}


module.exports = {
    SYSTEM_PROMPT,
    buildUserPrompt,
    evaluateBattleFlow,
    pickOpening
};
