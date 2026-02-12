// calcBattle.js
// 체력 계산, 스킬 데미지 계산, 효과 데미지 계산, weight 계산 전담

function calcHP(stats) {
    const {
        willScore,
        charmScore,
        worldScore,
        narrativeScore,
        ruleBreakScore,
        dominateScore,
        metaScore
    } = stats;

    let hp = 100;
    hp += (willScore || 0) * 3;
    hp += (charmScore || 0) * 3;
    hp += (worldScore || 0) * 3;

    if (narrativeScore <= 8) hp += narrativeScore * 2.5;
    else hp += 20;

    const penalty = (score) => {
        if (!score || score <= 5) return 0;
        return -1.35 * Math.pow(Math.E, 0.9 * (score - 5));
    };

    hp += penalty(ruleBreakScore);
    hp += penalty(dominateScore);
    hp += penalty(metaScore);

    return hp;
}

// weight multiplier
function getWeightMultiplier(turns) {
    if (turns === 1) return 1;
    if (turns === 2) return 1.05;
    return 1.1;
}

// turns/weights 기반으로 weight 결정
function getWeightValue(skill, usedTurn, currentTurn) {
    if (!skill) return 0;

    const turns = skill.turns;
    const weights = skill.weights;

    // ❗ 안전 처리 1: turns 또는 weights 없으면 효과 없음
    if (!turns || !Array.isArray(weights) || weights.length === 0) return 0;

    const diff = currentTurn - usedTurn;

    // ❗ 안전 처리 2: diff 범위 밖이면 효과 없음
    if (diff < 0 || diff >= turns) return 0;
    if (diff >= weights.length) return 0; // weights 부족

    const total = weights.reduce((a, b) => a + b, 0);
    if (!total) return 0; // 모든 weight가 0이면 보호

    const base = getWeightMultiplier(turns);
    return base * (weights[diff] / total);
}

// impact → AP/BP/AN/BN
function getImpactValues(skill, usedTurn, currentTurn, isMySkill) {
    if (!skill) return { AP: 0, BP: 0, AN: 0, BN: 0 };

    const impact = skill.impact;
    const val = getWeightValue(skill, usedTurn, currentTurn);

    let AP = 0, BP = 0, AN = 0, BN = 0;

    if (isMySkill) {
        if (impact === "A") AP = val;
        else BN = val;
    } else {
        if (impact === "A") BP = val;
        else AN = val;
    }
    return { AP, BP, AN, BN };
}

// 스킬 데미지
function calcSkillDamage(skill, Tcount, Fcount, combatScore, orderWeight) {
    if (!skill) return 0;

    const power = skill.power || 0;
    const base = 20 + power;

    const combatFactor = 1 + 0.2 * Math.log(combatScore || 1);
    const ratio = 1 + 0.1 * Tcount;

    const turnBonus = Math.pow(1.1, (skill.turns || 1) - 1);

    return base * combatFactor * ratio * turnBonus * orderWeight;
}

// 효과 데미지
function calcEffectDamage({
    AP, BP, AN, BN,
    mySupport, enemyCombat,
    skillTurns,
    isMyTurn,
    orderWeight
}) {
    const supportFactor = (s) => 1 + 0.2 * Math.log(s || 1);
    const combatFactor = (c) => 1 + 0.2 * Math.log(c || 1);

    let numerator = 20;
    let denomPart = 0;
    let effectPart = 0;

    if (isMyTurn) {
        denomPart = 6 + supportFactor(mySupport) * AP;
        effectPart = 6 + combatFactor(enemyCombat) * BN;
    } else {
        denomPart = 6 + supportFactor(mySupport) * BP;
        effectPart = 6 + combatFactor(enemyCombat) * AN;
    }

    const turnBonus = Math.pow(1.1, (skillTurns || 1) - 1);
    return (numerator / denomPart) * effectPart * turnBonus * orderWeight;
}

module.exports = {
    calcHP,
    calcSkillDamage,
    calcEffectDamage,
    getImpactValues
};
