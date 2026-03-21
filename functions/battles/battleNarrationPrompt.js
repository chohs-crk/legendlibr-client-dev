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
        return `${speechStyle}를 유지하되 ${name || "존재"}의 성격과 ${promptRefined}의 인상이 드러나는 짧은 발화`;
    }

    if (speechStyle) {
        return `${speechStyle}를 반영한 짧은 발화`;
    }

    if (promptRefined) {
        return `${name || "존재"}의 성격과 ${promptRefined}의 인상이 드러나는 짧은 발화`;
    }

    if (region) {
        return `${region}의 분위기를 닮은 절제된 짧은 발화`;
    }

    return `${name || "존재"}의 존재감을 드러내는 짧은 발화`;
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

    return lines.length ? lines.join("\n") : "- 두 존재는 서로의 작동과 움직임을 여러 차례 맞받아친다.";
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
        parts.push(`존재 인상:\n${cleanInline(character.promptRefined)}`);
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

function resolveOpeningDraft(myName, enemyName) {
    return [
        `- 서론은 **${myName}** 또는 **${enemyName}** 한쪽의 감지, 반응, 추적, 침입 대응, 관측, 봉쇄, 이상 징후 확인으로 시작할 수 있다.`,
        `- 초반부에는 두 존재를 강제로 한 화면에 세우지 말고, 같은 사건축 안에서 자연스럽게 수렴시켜라.`,
        `- 다른 한 존재는 같은 사건의 원인, 흔적, 방해자, 대응자, 추적 대상, 감지된 존재 중 하나로 연결되어야 한다.`,
        `- 사건의 성격과 전개 방식은 두 존재의 성질, 권능, 역할, 세계관 대비, 스킬 조합을 바탕으로 새롭게 설계하라.`,
        `- 매번 비슷한 접속부를 반복하지 말고, 상투적 갈등 문장 대신 장면 안에서 작동하는 구체적 징후와 변화로 빌드업하라.`,
        `- 제3의 인물이나 존재는 두 존재만으로 장면을 성립시키기 어려운 경우에만 최소한으로 사용하고, 중심은 언제나 **${myName}**와 **${enemyName}**여야 한다.`
    ].join("\n");
}

function buildDialogueRequirement(my, enemy) {
    const speakers = [my, enemy].filter((character) => character?.canSpeak);

    if (!speakers.length) {
        return `- 대사가 없는 전투이므로 §형식§ 대사를 넣지 마라.`;
    }

    const speakerNames = speakers
        .map((character) => `**${character.displayRawName}**`)
        .join(", ");

    return [
        `- 이번 전투에서는 말할 수 있는 존재가 있으므로, 전투 전체에서 §형식§ 대사를 최소 1회 이상 반드시 넣어라.`,
        `- 대사를 할 수 있는 존재: ${speakerNames}`,
        `- 최소 1회의 대사는 반드시 위 존재들 중 하나에게서 나와야 하며, 대사가 없는 존재에게 억지로 발화시키지 마라.`
    ].join("\n");
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
- "충돌했다", "시작되었다", "끝났다", "예고했다", "흐름이 바뀌었다" 같은 전형적 문장 금지.
- 유저 프롬프트의 지시문을 바탕으로 두 존재의 성질에 어울리게 재창작하여 상황을 작성해야 한다.
- 유저 프롬프트에 적힌 초안 문장을 그대로 늘이거나 나열하지 말고, 장면과 행동으로 변환해 서술하라.

[문체 규칙]
- 하나의 단편 소설처럼 작성한다.
- 반드시 아래 길이 조건을 모두 만족해야 한다:

· 글자 수: 600~800자 (띄어쓰기 포함 기준)
· 문장 수: 10~16문장
· 단어 수: 300~500단어 수준

- 위 조건 중 하나라도 벗어나면 잘못된 출력이다.
- 길이를 맞추기 위해 의미 없는 반복 금지
- 문장을 억지로 늘리거나 줄이지 말 것
- 존재의 감정선과 작동 방식을 중심으로 장면을 묘사한다.
- 원인과 동기를 직접 서술하라.
- 모호한 서술 금지.
- 지역 분위기를 재해석하여 녹여라.
- 두 지역 중 하나의 배경에서 전투하거나 혹은 별개의 공간을 배경으로 해도 된다.
- 문어체의 밀도와 담백한 묘사를 함께 유지하라.

[오프닝 전개 규칙]
- 서론은 두 존재를 억지로 한 장면에 세우는 방식으로 시작하지 마라.
- 초반은 하나의 사건, 이상 징후, 임무, 침입, 균열, 관측, 오작동, 추적 흔적, 봉쇄 해제, 신호 왜곡 등 구체적인 변화에서 시작하라.
- 한 존재의 시점이나 행동으로 먼저 시작할 수 있다.
- 그러나 초반 4문장 안에는 다른 한 존재가 반드시 같은 사건의 원인, 대응자, 방해자, 추적 대상, 감지된 존재, 작동 원리 중 하나로 자연스럽게 연결되어야 한다.
- 두 존재의 서술이 따로 노는 독립적인 소개문처럼 분리되면 실패다.
- "둘은 마주했다", "서로를 발견했다", "같은 공간에서 서로를 의식했다" 같은 기계적 합류 문장을 우선적으로 사용하지 마라.
- 만남은 감지, 흔적, 반응, 간섭, 파손, 침입 신호, 관측 결과, 봉쇄 붕괴, 현상 변형 등 사건의 결과로 자연스럽게 발생해야 한다.
- 사건의 종류와 전개 방식은 두 존재의 성질, 권능, 역할, 세계관 대비, 스킬의 작동 결과를 바탕으로 매번 새롭게 설계하라.
- 과거의 원한, 잊힌 약속, 묻힌 진실, 신념의 충돌 같은 추상 오프닝 상투구를 기본값처럼 반복하지 마라.
- 제3의 인물이나 존재는 두 존재만으로 장면이 성립하기 어려운 경우(예: 무생물적 존재끼리의 상호작용을 드러내기 위한 최소 매개) 에만 제한적으로 사용하라.
- 제3의 존재를 쓰더라도 중심은 언제나 두 존재이며, 제3자는 사건을 연결하는 보조 장치일 뿐 서사의 주인이 되어서는 안 된다.

[과거 회상 규칙]
- 캐릭터의 과거(fullStory)는 그대로 사용하지 마라.
- 사건을 재해석하여 장면 속 회상으로 녹여라.
- 요약하거나 복붙하지 말고 감정과 상황을 중심으로 재창작하라.

[회상/재해석 데이터 사용 금지 강화]
- "회상 재해석 자료, 이전 스토리" 섹션의 문장/표현/대사를 **그대로 반복**하면 실패다.
- 원문과 의미가 비슷하더라도 **문장 구조/어휘/이미지**를 바꿔 새로 쓰되, 설정의 핵심 사실만 활용하라.
- 이전 로그/이전 전투/과거에 썼던 표현을 재사용하지 마라. (특히 결말 문장, 전형적 수식어, 동일 비유)

[지역 규칙]
- region은 존재의 탄생 배경이다.
- 두 존재의 출신 배경 대비를 장면에 자연스럽게 반영하라.
- 지역 설명을 그대로 복사하지 말 것.

[강조 규칙]
- 존재 이름, 지역, 핵심 개념은 **강조** 형식 사용.
- 대사는 반드시 §대사§ 형식.
- 스킬은 반드시 『스킬명』 형식.

[스킬 규칙]
- 각 존재는 최대 3개 스킬을 사용한다.
- 스킬 이름과 긴 설명이 들어간 것에 대해선 그 스킬 설명을 그대로 서술하지 말고, 스킬로 인한 결과를 생각해 창작할 것.
- 유저 프롬프트에 언급된 스킬 이름은 반드시 강조 규칙대로 서술한다.
- [전투 로그 초안]에 배치된 스킬 교환 순서는 서사의 뼈대로 유지하라.

[대사 규칙]
- 대사가 주어진 경우에만 §형식§ 사용.
- 이번 전투에 canSpeak가 true인 존재가 하나라도 있다면, 전투 전체에서 §형식§ 대사를 최소 1회 이상 반드시 넣어라.
- 대사가 없는 존재는 절대 말하지 않는다.

[대사 원문 재사용 금지]
- 제공된 대사가 있더라도 **원문을 그대로 복사**하거나 한 글자만 바꿔 재사용하지 마라.
- 의미는 유지하되, 말투 지침을 반영해 **완전히 다른 문장**으로 재작성하라.
- 따옴표(“ ”, " ")로 인용하는 방식 금지. 대사는 오직 §대사§ 형태로만 쓸 것.
- 유저 프롬프트에 적힌 대사 단서는 말의 방향과 태도만 참고하고, 실제 출력 문장은 반드시 새로 만들어라.
- 대사 단서가 실제 문장이 아니라 발화 방향 설명일 수도 있으므로, 그 문구를 그대로 출력하지 말고 상황에 맞는 새 대사로 바꿔 써라.

[대사 스타일 규칙]
- 대사가 존재하는 경우에는 제공된 말투 지침을 반영하라.
- 말투 지침이 제공되지 않은 존재는 말하지 않는다.

[승패 오인 방지 규칙]
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
- 반드시 아래 조건을 모두 만족해야 한다:
    · 글자 수: 600~800자 (띄어쓰기 포함)
    · 문장 수: 10~16문장
    · 단어 수: 300~500단어 수준

    - 토큰 기준이 아닌 실제 한글 문자 길이 기준이다.
    - 조건 위반 시 출력 전체가 실패로 간주된다.
- 토큰 기준이 아닌 실제 한글 문자 길이 기준이다.
- 승패를 반대로 서술하면 출력 전체가 폐기된다.
- 결말은 반드시 유저가 지정한 승패를 기계적으로 확정하는 방식으로 작성하라.
[도덕성 독립 규칙]

- 선함, 희생, 정의감은 승패와 무관하다.
- 감정적으로 더 설득력 있어 보이는 존재가 패배할 수 있다.
- 모델은 공감도에 따라 승패를 조정해서는 안 된다.
- 도덕성에 위배되는 경우 존재를 **확장 해석**하여 승패에 녹아들도록 귀결시키며,
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
5. 초반 4문장 안에서 두 존재가 같은 사건축으로 연결되었는가?
6. 이번 전투에 canSpeak가 true인 존재가 있다면 §형식§ 대사가 최소 1회 이상 실제로 들어갔는가?
7. 대사가 있다면 원문을 반복하지 않았는가?
8. 제3의 존재가 필요 이상으로 중심을 차지하지 않았는가?

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
        enemy.displayRawName
    );
    const dialogueRequirement = buildDialogueRequirement(my, enemy);

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
- 서론은 **${my.displayRawName}** 또는 **${enemy.displayRawName}** 한쪽의 감지, 반응, 추적, 이상 징후 확인, 관측, 작동으로 먼저 시작할 수 있다.
- 그러나 초반 4문장 안에는 다른 한 존재가 반드시 같은 사건의 원인, 흔적, 방해, 대응, 추적 대상, 감지된 존재 중 하나로 자연스럽게 연결되어야 한다.
- 두 존재의 소개가 따로 분리되어 각자 놀면 실패다. 초반은 반드시 하나의 사건축으로 이어져야 한다.
- 필요하지 않은 제3의 인물/존재를 늘리지 말고, 부득이하게 쓰더라도 두 존재가 중심이어야 한다.
- 마지막 문장은 **${winnerName}**(승자)와 **${loserName}**(패자)를 함께 포함하고 **$&로 시작해서 $&로 끝나야 한다.** (즉, $&...$&)
- 마지막 문장은 직설("누가 이겼다") 금지. 은유/비유로 승패를 확정하되 승자/패자는 절대 바뀌면 안 된다.

────────────────────────

[${my.displayRawName} 존재 초안]
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

[${enemy.displayRawName} 존재 초안]
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

오프닝 설계:
${openingDraft}
- 오프닝은 설명형 선언이 아니라 장면 안에서 감지되는 변화와 반응으로 시작한다.
- 같은 사건축 안에서 두 존재의 성질과 세계관 대비가 자연스럽게 맞물려야 한다.
- 사건은 상투적인 갈등 문구가 아니라 두 존재의 조합에서 비롯된 독자적 형태여야 한다.

대사 배치 조건:
${dialogueRequirement}

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
- 두 존재의 출신 지역 대비를 장면에 자연스럽게 반영할 것.
- 지역 설명, 이전 스토리, 대사 단서를 그대로 복사하지 말 것.
- 사건의 성격과 전개는 두 존재의 성질, 역할, 스킬, 세계관 대비를 바탕으로 창의적으로 설계할 것.
- 반복되는 오프닝 패턴, 상투적 갈등 문구, 기계적인 조우 문장을 피할 것.
- 대사가 주어진 경우에만 §형식§ 사용, 주어지지 않은 존재는 말시키지 말 것.
- canSpeak가 true인 존재가 하나라도 있으면 전투 전체에서 §형식§ 대사를 최소 1회 이상 반드시 넣을 것.
- 대사가 있더라도 원문을 복사하지 말고 말투와 태도만 반영해 새 문장으로 만들 것.
- 스킬은 최대 3개씩 사용하며, 위 초안의 교차 배치를 뼈대로 삼아 장면으로 확장할 것.
- 제3의 인물이나 존재는 꼭 필요한 경우에만 최소한으로 사용하고, 중심은 두 존재에게 둘 것.

────────────────────────

[작성 시 반드시 지킬 것]
-글자수:600~800자(띄어쓰기포함)
    -문장수:10~16문장
    -단어수:300~500단어수준
    -조건위반시잘못된출력으로간주
- 하나의 단편 서사 구조
- 구조 설명 금지
- 진부한 표현 금지
- 실제 수치 언급 금지
- 감정선, 작동 방식, 현상 변화 중심 묘사
- 과거는 회상 장면이나 현재를 밀어내는 단서로 재해석
- 지역은 탄생 배경으로서 대비되게 반영
- 결말은 마지막 문장을 $&...$&로 감싸 확정 (앞뒤 모두)
-초안의사실관계는유지하되문장은새로작성
-출력전반드시스스로길이조건을검증하고맞지않으면수정하라
`;
}

/* =========================================================
   🔥 판정 계산
========================================================= */
function evaluateTurnDiff(diff) {
    if (diff < 10) return "서로 쉽게 물러서지 않는 팽팽한 대치였다.";
    if (diff < 40) return "한쪽이 점차 주도권을 움켜쥐는 양상이었다.";
    return "팽팽하던 흐름이 점차 한 존재에게 유리하게 기울어 갔다.";
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

module.exports = {
    SYSTEM_PROMPT,
    buildUserPrompt,
    evaluateBattleFlow
};
