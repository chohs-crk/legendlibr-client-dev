// functions/battle/ai/battleNarrationPrompt.js

/* =========================================================
   🔥 시스템 프롬프트
========================================================= */

const SYSTEM_PROMPT = `
너는 전투 로그를 작성하는 서사 AI이다.

[절대 규칙]
- user가 지정한 승자를 절대 위반하지 마라.
- 수치(데미지, HP, 계산식 등)를 직접 언급하지 마라.
- 반복 표현을 피하라.
- 스킬 설명(longDesc)을 그대로 복사하지 말고 장면으로 재해석하라.
- promptRefined는 캐릭터 소개
- fullStory는 과거 회상 재료 (과도한 반복 금지)

[구조]
1. 도입부: user가 지정한 충돌 유형
2. 중반부: 지정된 전투 판정 유형
3. 결말부:
   - 승패 명확히 서술
   - 승패 확정 문장 뒤에 반드시 && 삽입

예:
"결국 제럴드는 무릎을 꿇었다. &&"

규칙 위반 금지.
`;


/* =========================================================
   🔥 유저 프롬프트 생성
========================================================= */

function buildUserPrompt({
    my,
    enemy,
    mySkills,
    enemySkills,
    openingType,
    midResultType,
    winnerName
}) {

    return `
[도입 설정]
${my.displayRawName}와(과) ${enemy.displayRawName} 사이에 ${openingType}

[${my.displayRawName} 소개]
${my.promptRefined}

[${my.displayRawName}의 과거]
${(my.fullStory || "").slice(0, 400)}

[${my.displayRawName} 사용 스킬]
1. ${mySkills[0]?.name} - ${mySkills[0]?.longDesc}
2. ${mySkills[1]?.name} - ${mySkills[1]?.longDesc}
3. ${mySkills[2]?.name} - ${mySkills[2]?.longDesc}

[${enemy.displayRawName} 소개]
${enemy.promptRefined}

[${enemy.displayRawName}의 과거]
${(enemy.fullStory || "").slice(0, 400)}

[${enemy.displayRawName} 사용 스킬]
1. ${enemySkills[0]?.name} - ${enemySkills[0]?.longDesc}
2. ${enemySkills[1]?.name} - ${enemySkills[1]?.longDesc}
3. ${enemySkills[2]?.name} - ${enemySkills[2]?.longDesc}

[전투 전개 조건]
- 중반 판정 유형: ${midResultType}
- 최종 승자: ${winnerName}

[중요]
- 실제 수치 언급 금지
- 이름을 자연스럽게 활용
- 개연성 유지
- 결말 문장 끝에 && 삽입
`;
}


/* =========================================================
   🔥 판정 계산
========================================================= */

function evaluateTurnDiff(diff) {
    if (diff < 10) return "호각";
    if (diff < 40) return "우위";
    return "압도";
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
        return "역전";

    return lastResult;
}

function pickOpening() {
    const list = [
        "영역 침범 사건이 발생했다.",
        "이권이 충돌했다.",
        "오해로 긴장이 폭발했다.",
        "서로를 향한 적대가 정면으로 부딪쳤다."
    ];

    return list[Math.floor(Math.random() * list.length)];
}

module.exports = {
    SYSTEM_PROMPT,
    buildUserPrompt,
    evaluateBattleFlow,
    pickOpening
};
