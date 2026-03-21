// functions/battle/ai/battleNarrationPrompt.js

/* =========================================================
   🔥 공통 유틸
========================================================= */
function trimRegionDetail(text) {
    if (!text) return "";

    if (text.length <= 150) return text;

    let cut = 150;

    for (let i = 150; i < text.length; i++) {
        const ch = text[i];
        const prev = text[i - 1];

        const isEnd = (ch === "." || ch === "?" || ch === "!") && prev !== ".";

        if (isEnd) {
            cut = i + 1;
            break;
        }
    }

    return text.slice(0, cut).trim();
}

function normalizeWhitespace(text) {
    return String(text || "")
        .replace(/\r\n/g, "\n")
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function cleanInline(text) {
    return normalizeWhitespace(text)
        .replace(/\n+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function splitSentences(text) {
    return normalizeWhitespace(text)
        .split(/(?<=[.!?。！？])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function extractDialoguePool(text = "") {
    const out = [];
    const regex = /§([^§]+?)§/g;

    let match;
    while ((match = regex.exec(String(text || ""))) !== null) {
        const raw = cleanInline(match[1]);
        if (raw) out.push(raw);
    }

    return out;
}

function stripDialogues(text = "") {
    return normalizeWhitespace(String(text || "").replace(/§[^§]*§/g, " "));
}

function isDialogueUsable(line = "") {
    const text = cleanInline(line);

    if (!text) return false;
    if (text.length < 4 || text.length > 54) return false;
    if (/^[0-9]+$/.test(text)) return false;
    if (/^(설명|서술|배경|장면|회상|과거)/.test(text)) return false;
    if (/[:：]/.test(text)) return false;

    return true;
}

function pickDialogueSamples(lines = [], probability = 0.1, maxCount = 2) {
    const picked = [];

    for (const line of lines) {
        if (!isDialogueUsable(line)) continue;
        if (Math.random() < probability) {
            picked.push(line);
        }
    }

    return picked.slice(0, maxCount);
}

function buildFallbackDialogueHint(character = {}) {
    const speechStyle = cleanInline(character.speechStyle || "");
    const promptRefined = cleanInline(character.promptRefined || "");
    const region = cleanInline(character.region || "");
    const name = cleanInline(character.displayRawName || "");

    if (speechStyle && promptRefined) {
        return `${speechStyle}를 유지하되 ${name || "인물"}의 성격과 ${promptRefined}의 인상이 드러나는 짧은 발화`;
    }

    if (speechStyle) {
        return `${speechStyle}를 반영한 짧은 발화`;
    }

    if (promptRefined) {
        return `${name || "인물"}의 성격과 ${promptRefined}의 인상이 드러나는 짧은 발화`;
    }

    if (region) {
        return `${region}의 분위기를 닮은 절제된 짧은 발화`;
    }

    return `${name || "인물"}의 존재감을 드러내는 짧은 발화`;
}

function buildNarrativeFragments(fullStory = "", maxItems = 4) {
    const sentences = splitSentences(stripDialogues(fullStory));
    const fragments = [];

    for (const sentence of sentences) {
        const cleaned = cleanInline(sentence)
            .replace(/[.?!。！？]+$/g, "")
            .trim();

        if (!cleaned) continue;
        if (cleaned.length < 8) continue;

        const compact = cleaned.length > 70 ? `${cleaned.slice(0, 70).trim()}…` : cleaned;
        fragments.push(compact);

        if (fragments.length >= maxItems) break;
    }

    return fragments;
}

function buildSkillDirective(skill, isMajor) {
    if (!skill) return "";

    const name = cleanInline(skill.name || "이름 없음");
    const raw = isMajor ? skill.longDesc || skill.shortDesc || "" : skill.shortDesc || skill.longDesc || "";
    const desc = cleanInline(raw);

    if (!desc) return `『${name}』을 사용한다.`;
    return `『${name}』로 ${desc}`;
}

function shufflePair(pair) {
    const arr = pair.filter(Boolean);
    if (arr.length <= 1) return arr;
    if (Math.random() < 0.5) arr.reverse();
    return arr;
}

function buildInterleavedBattleDraft({
    my,
    enemy,
    mySkills,
    enemySkills,
    myTop2Idx,
    enemyTop2Idx,
    turnLogs
}) {
    const lines = [];
    const turnCount = Math.max(
        Array.isArray(turnLogs) ? turnLogs.length : 0,
        Array.isArray(mySkills) ? mySkills.length : 0,
        Array.isArray(enemySkills) ? enemySkills.length : 0
    );

    for (let i = 0; i < turnCount; i++) {
        const pair = [];

        if (mySkills[i]) {
            const isMajor = !Array.isArray(myTop2Idx) || myTop2Idx.includes(i);
            pair.push(`- ${my.displayRawName}: ${buildSkillDirective(mySkills[i], isMajor)}`);
        }

        if (enemySkills[i]) {
            const isMajor = !Array.isArray(enemyTop2Idx) || enemyTop2Idx.includes(i);
            pair.push(`- ${enemy.displayRawName}: ${buildSkillDirective(enemySkills[i], isMajor)}`);
        }

        lines.push(...shufflePair(pair));
    }

    return lines.length ? lines.join("\n") : "- 두 인물은 서로의 움직임을 여러 차례 맞받아친다.";
}

function buildCharacterSeed({ character, originName }) {
    const narrativeFragments = buildNarrativeFragments(character.fullStory || "", 4);
    let sampledDialogue = [];

    if (character.canSpeak) {
        sampledDialogue = pickDialogueSamples(
            extractDialoguePool(character.fullStory || ""),
            0.1,
            2
        );

        if (!sampledDialogue.length) {
            sampledDialogue = [buildFallbackDialogueHint(character)];
        }
    }

    const parts = [
        `이름: **${character.displayRawName}**`,
        `출신 세계관: **${originName || "미지"}**`,
        `출신 지역: **${character.region || "미지"}**`
    ];

    const regionDetail = trimRegionDetail(character.regionDetail || "");
    if (regionDetail) {
        parts.push(`지역 단서:\n${regionDetail}`);
    }

    if (cleanInline(character.promptRefined || "")) {
        parts.push(`인물 인상:\n${cleanInline(character.promptRefined)}`);
    }

    if (narrativeFragments.length) {
        parts.push(`과거 단서:\n${narrativeFragments.map((line) => `- ${line}`).join("\n")}`);
    }

    if (sampledDialogue.length) {
        parts.push(`말로 드러날 수 있는 단서:\n${sampledDialogue.map((line) => `- §${line}§`).join("\n")}`);
    }

    if (character.canSpeak && cleanInline(character.speechStyle || "")) {
        parts.push(`말투 참고:\n${cleanInline(character.speechStyle)}`);
    }

    return parts.join("\n\n");
}

function resolveOpeningDraft(myName, enemyName, openingType) {
    if (!openingType || openingType === "__AI_GENERATE__") {
        return `**${myName}**와(과) **${enemyName}**는 같은 공간에서 서로를 먼저 인식한 채, 승패와 무관한 이유로 마주 선다.`;
    }

    return `**${myName}**와(과) **${enemyName}**는 ${openingType}`;
}

/* =========================================================
   🔥 시스템 프롬프트
========================================================= */
const SYSTEM_PROMPT = `
너는 전투 로그를 작성하는 서사 AI이다.

[절대 규칙]
- 유저 프롬프트의 [전투 전개 조건]과 [고정 정보]는 **사실**로 고정하라. 해석으로 뒤집거나 무시하면 실패다.
- 유저 프롬프트의 [전투 로그 초안]은 이미 사실관계가 정리된 초안이다. 사건 순서와 결말을 유지한 채 장면과 감정으로 확장하라.
- 유저가 지정한 **최종 승자/최종 패자**를 절대 위반하지 마라. 승자/패자를 바꿔치기하면 실패다.
- 수치(데미지, HP, 계산식, 퍼센트, 턴 수치 등)를 직접 언급하지 마라.
- 반복 표현을 피하라.
- 구조를 설명하지 마라.
- 도입부/중반부/결말부 같은 표현 금지.
- "충돌했다", "시작되었다", "끝났다", "예고했다",
  "흐름이 바뀌었다" 같은 전형적 문장 금지.
- 유저 프롬프트의 지시문을 바탕으로 캐릭터에 어울리게 재창작하여 상황을 작성해야 한다.
- 유저 프롬프트에 적힌 초안 문장을 그대로 늘이거나 나열하지 말고, 장면과 행동으로 변환해 서술하라.

[문체 규칙]
- 하나의 단편 소설처럼 600~800자.
- 인물의 감정선과 행동을 중심으로 장면 묘사.
- 원인과 동기를 직접 서술하라.
- 모호한 서술 금지.
- 지역 분위기를 재해석하여 녹여라.
- 두 지역 중 하나의 배경에서 전투하거나 혹은 별개의 공간을 배경으로 해도 된다.
- 문어체의 밀도와 담백한 묘사를 함께 유지하라.

[등장 타이밍 규칙]  (🔥 한 캐릭터 늦게 등장 방지)
- **첫 2문장 안에 두 인물의 이름이 모두 등장**해야 한다. 한쪽만 오래 끌면 실패다.
- 시작은 설명이 아니라, **두 인물이 이미 같은 공간에서 서로를 의식하는 장면**이어야 한다.
- **첫 4문장 안에 두 인물이 최소 1회씩 행동**해야 한다. (움직임/공격/회피/주문/심리적 압박 등)

[과거 회상 규칙]
- 캐릭터의 과거(fullStory)는 그대로 사용하지 마라.
- 사건을 재해석하여 장면 속 회상으로 녹여라.
- 요약하거나 복붙하지 말고 감정과 상황을 중심으로 재창작하라.

[회상/재해석 데이터 사용 금지 강화]
- "회상 재해석 자료, 이전 스토리" 섹션의 문장/표현/대사를 **그대로 반복**하면 실패다.
- 원문과 의미가 비슷하더라도 **문장 구조/어휘/이미지**를 바꿔 새로 쓰되, 설정의 핵심 사실만 활용하라.
- 이전 로그/이전 전투/과거에 썼던 표현을 재사용하지 마라. (특히 결말 문장, 전형적 수식어, 동일 비유)

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
- [전투 로그 초안]에 배치된 스킬 교환 순서는 서사의 뼈대로 유지하라.

[대사 규칙]
- 대사가 주어진 경우에만 §형식§ 사용.
- 대사가 없는 캐릭터는 절대 말하지 않는다.

[대사 원문 재사용 금지]
- 제공된 대사가 있더라도 **원문을 그대로 복사**하거나 한 글자만 바꿔 재사용하지 마라.
- 의미는 유지하되, 말투 지침을 반영해 **완전히 다른 문장**으로 재작성하라.
- 따옴표(“ ”, " ")로 인용하는 방식 금지. 대사는 오직 §대사§ 형태로만 쓸 것.
- 유저 프롬프트에 적힌 대사 단서는 말의 방향과 태도만 참고하고, 실제 출력 문장은 반드시 새로 만들어라.
- 대사 단서가 실제 문장이 아니라 발화 방향 설명일 수도 있으므로, 그 문구를 그대로 출력하지 말고 상황에 맞는 새 대사로 바꿔 써라.

[대사 스타일 규칙]
- 대사가 존재하는 캐릭터는 제공된 말투 지침을 반영하라.
- 말투 지침이 제공되지 않은 인물은 말하지 않는다.

[승패 오인 방지 규칙]  (승패 뒤집힘/모호함 방지)
- 승패는 분명히 묘사하라.
- 핵심 전환점과 결말은 대명사(그/그녀/상대/누군가)로 흐리지 말고 **이름**으로 확정하라.
- 마지막 문장 바로 전 문장에서 **패자의 패배 상태를 확정**하라.
  (예: 기절/봉인/무장해제/항복/도주/완전 무력화 중 하나 이상을 구체적으로)
- 마지막 문장은 반드시 **승자 이름**과 **패자 이름**을 함께 포함하고,
  문장 **앞뒤를 $&로 감싸라**. (예: $&...$&)
- 마지막 문장은 "누가 이겼다/졌다" 같은 직설 문장 금지.
  대신 **은유/비유적 표현**으로 승패를 확정하되, **승자/패자**가 누구인지 절대 흐려지면 실패다.
- 마지막 문장에서는 대명사(그/그녀/상대/누군가) 사용 금지. 반드시 두 이름을 직접 명시하라.

규칙 위반 금지.
- 반드시 600자 이상 800자 이하의 실제 글자 수로 작성하라.
- 토큰 기준이 아닌 실제 한글 문자 길이 기준이다.
- 승패를 반대로 서술하면 출력 전체가 폐기된다.
- 결말은 반드시 유저가 지정한 승패를 기계적으로 확정하는 방식으로 작성하라.
[도덕성 독립 규칙]

- 선함, 희생, 정의감은 승패와 무관하다.
- 감정적으로 더 설득력 있어 보이는 인물이 패배할 수 있다.
- 모델은 공감도에 따라 승패를 조정해서는 안 된다.
- 도덕성에 위배되는 경우 캐릭터를 **확장 해석**하여 승패에 녹아들도록 귀결시키며,
 특수한 규칙, 상대에게 경외감, 감탄 등 감정 주기, 압도적인 힘을 보여주고 자비 베풀기 등 승리에 대한 개념을 재해석하여
도덕적 문제를 해결하면서 승리를 확실하게 보여준다.
[서사적 반전 금지 규칙]

- 극적 반전, 감정적 각성, 희생을 통한 역전 같은 전개를 만들지 마라.
- 최종 승패는 이미 확정된 사실이며, 서사는 그 사실을 향해 수렴해야 한다.
- 중반 묘사는 긴장감만 만들고, 승패를 바꾸는 역할을 해서는 안 된다.
- 패자가 도덕적으로 우월해 보이더라도 결과는 절대 바뀌지 않는다.
- 도덕적으로 "전투를 바탕으로 승리할 수 없다"면 의지를 꺾는다, 새로운 길을 열어준다 등으로 대신한다.
[내부 검증 단계]

글을 마치기 전에 반드시 다음을 내부적으로 확인하라:
1. 최종 승자가 유저 지정 승자와 동일한가?
2. 패자가 완전 무력화 상태로 명확히 묘사되었는가?
3. 마지막 문장이 정확히 $&로 시작하고 $&로 끝나는가? (즉, $&...$&)
4. 마지막 문장이 비유/은유이면서도 승자/패자가 모호하지 않은가?
5. 첫 2문장 안에 두 이름이 모두 등장했는가?
6. 대사가 있다면 원문을 반복하지 않았는가?

하나라도 충족하지 않으면 출력하지 말고 수정하라.
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
    winnerName,
    loserName,
    turnLogs
}) {
    const mySeed = buildCharacterSeed({
        character: my,
        originName: myOriginName
    });

    const enemySeed = buildCharacterSeed({
        character: enemy,
        originName: enemyOriginName
    });

    const openingDraft = resolveOpeningDraft(
        my.displayRawName,
        enemy.displayRawName,
        openingType
    );

    const interleavedBattleDraft = buildInterleavedBattleDraft({
        my,
        enemy,
        mySkills,
        enemySkills,
        myTop2Idx,
        enemyTop2Idx,
        turnLogs
    });

    return `
[고정 정보]
- 최종 승자(절대 고정): **${winnerName}**
- 최종 패자(절대 고정): **${loserName}**
- 첫 2문장 안에 **${my.displayRawName}**, **${enemy.displayRawName}** 둘 다 등장해야 한다.
- 첫 4문장 안에 두 인물이 최소 1회씩 행동해야 한다. (한쪽을 늦게 투입 금지)
- 시작은 설명이 아니라 이미 서로를 의식한 장면이어야 한다.
- 마지막 문장은 **${winnerName}**(승자)와 **${loserName}**(패자)를 함께 포함하고 **$&로 시작해서 $&로 끝나야 한다.** (즉, $&...$&)
- 마지막 문장은 직설("누가 이겼다") 금지. 은유/비유로 승패를 확정하되 승자/패자는 절대 바뀌면 안 된다.

────────────────────────

[${my.displayRawName} 인물 초안]
${mySeed}

행동 단서:
${(mySkills || [])
            .map((skill, i) => {
                const isMajor = !Array.isArray(myTop2Idx) || myTop2Idx.includes(i);
                return `- ${buildSkillDirective(skill, isMajor)}`;
            })
            .join("\n")}
- 위 스킬 이름과 결과 단서는 유지하되, 긴 설명을 복붙하지 말고 결과 중심으로 재창작할 것.

────────────────────────

[${enemy.displayRawName} 인물 초안]
${enemySeed}

행동 단서:
${(enemySkills || [])
            .map((skill, i) => {
                const isMajor = !Array.isArray(enemyTop2Idx) || enemyTop2Idx.includes(i);
                return `- ${buildSkillDirective(skill, isMajor)}`;
            })
            .join("\n")}
- 위 스킬 이름과 결과 단서는 유지하되, 긴 설명을 복붙하지 말고 결과 중심으로 재창작할 것.

────────────────────────

[전투 로그 초안]
승리한 플레이어: **${winnerName}**
패배한 플레이어: **${loserName}**

인물 배치:
- ${openingDraft}
- 오프닝에서 이름 배치는 승패와 무관하게 **${my.displayRawName}**를 먼저, 그다음 **${enemy.displayRawName}**를 둔다.
- 두 인물은 시작부터 같은 장면 안에서 서로를 경계하거나 겨눈다.

전개 분위기:
- ${midResultType}

전투 전개:
${interleavedBattleDraft}

결말 초안:
- 결국 **${winnerName}**가 **${loserName}**를 꺾는다.
- 마지막 문장 바로 전 문장에서 **${loserName}**의 패배 상태를 구체적으로 확정한다.
- 마지막 문장은 반드시 **${winnerName}**와 **${loserName}**를 함께 넣고, 전개 분위기와 전투 결과를 비유적으로 봉합하는 문장으로 끝맺는다.

────────────────────────

[전투 전개 조건]
- 중반 전개 분위기: ${midResultType}
- 최종 승자: **${winnerName}**
- 최종 패자: **${loserName}**
- 두 캐릭터의 출신 지역 대비를 장면에 자연스럽게 반영할 것.
- 지역 설명, 이전 스토리, 대사 단서를 그대로 복사하지 말 것.
- 대사가 주어진 경우에만 §형식§ 사용, 주어지지 않은 인물은 말시키지 말 것.
- 대사가 있더라도 원문을 복사하지 말고 말투와 태도만 반영해 새 문장으로 만들 것.
- 스킬은 최대 3개씩 사용하며, 위 초안의 교차 배치를 뼈대로 삼아 장면으로 확장할 것.

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
- 결말은 마지막 문장을 $&...$&로 감싸 확정 (앞뒤 모두)
- 초안의 사실관계는 유지하되 문장은 새로 작성
`;
}

/* =========================================================
   🔥 판정 계산
========================================================= */
function evaluateTurnDiff(diff) {
    if (diff < 10) return "서로 쉽게 물러서지 않는 팽팽한 대치였다.";
    if (diff < 40) return "한쪽이 점차 주도권을 움켜쥐는 양상이었다.";
    return "팽팽하던 흐름이 점차 한 사람에게 유리하게 기울어 갔다.";
}

function evaluateBattleFlow(turnLogs) {
    if (!turnLogs || turnLogs.length === 0) return "호각";

    const t1 = Math.abs(turnLogs[0].my.totalDmg - turnLogs[0].enemy.totalDmg);

    const last = turnLogs[turnLogs.length - 1];
    const t3 = Math.abs(last.my.hpAfter - last.enemy.hpAfter);

    const firstResult = evaluateTurnDiff(t1);
    const lastResult = evaluateTurnDiff(t3);

    if (firstResult !== lastResult)
        return "팽팽하던 기색이 어느 순간, 누구도 부정할 수 없는 균열을 드러냈다.";

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
