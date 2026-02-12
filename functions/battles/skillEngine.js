// skillEngine.js
// 턴별 스킬 선택, AI 순서 가중치, 지속효과 누적, weight(diff) 계산, 턴배율 포함

const {
    calcSkillDamage,
    calcEffectDamage,
    getImpactValues
} = require("./calcBattle");

// =======================================
//  0. 스킬 3개 뽑기
// =======================================
function pickRandom3Skills(skills) {
    const arr = [...skills];
    while (arr.length > 3) arr.splice(Math.floor(Math.random() * arr.length), 1);
    return arr;
}

// =======================================
//  1. 스킬 순서 가중치
// =======================================
function calcOrderWeight(aiOrder, picked) {
    const pickedOrder = picked.map((_, i) => i).join("");

    if (pickedOrder === aiOrder.slice(0, 3)) return 1.2;

    let hit = 0;
    for (let c of pickedOrder) if (aiOrder.includes(c)) hit++;
    if (hit >= 2) return 1.1;

    return 1.0;
}

// =======================================
//  2. 지속효과 누적 (Aura)
// =======================================

// auraQueue = [
//   { caster:'my', skill: {...}, usedTurn:1 },
//   { caster:'enemy', skill:{...}, usedTurn:2 },
//   ...
// ]

let auraQueue = [];

// aura = 턴마다 계산되는 누적값
let aura = {
    my: { AP: 0, BP: 0, AN: 0, BN: 0 },
    enemy: { AP: 0, BP: 0, AN: 0, BN: 0 }
};

function addAuraEffect(caster, skill, usedTurn) {
    // skill 또는 weight 구조가 없을 경우 무시
    if (!skill || !skill.turns || !Array.isArray(skill.weights)) return;

    auraQueue.push({ caster, skill, usedTurn });
}

function updateAura(currentTurn) {
    aura = {
        my: { AP: 0, BP: 0, AN: 0, BN: 0 },
        enemy: { AP: 0, BP: 0, AN: 0, BN: 0 }
    };

    for (const item of auraQueue) {
        const diff = currentTurn - item.usedTurn;

        if (diff < 0) continue;
        if (diff >= item.skill.turns) continue; // 지속 끝

        // diff 번째 weight 적용
        const vals = getImpactValues(item.skill, item.usedTurn, currentTurn, item.caster === "my");

        aura[item.caster].AP += vals.AP;
        aura[item.caster].BP += vals.BP;
        aura[item.caster].AN += vals.AN;
        aura[item.caster].BN += vals.BN;
    }
}


// =======================================
//  3. 한 턴 시뮬레이션
// =======================================
function simulateTurn({
    turn,
    mySkill,
    enemySkill,
    myTF,
    enemyTF,
    mySupport,
    enemySupport,
    myCombat,
    enemyCombat,
    myOrderWeight,
    enemyOrderWeight
}) {
  


    if (mySkill) addAuraEffect("my", mySkill, turn);
    if (enemySkill) addAuraEffect("enemy", enemySkill, turn);


    // 이번 턴 포함 전체 지속효과 적용
    updateAura(turn);

    const totalMy = aura.my;
    const totalEnemy = aura.enemy;

    // 🔥 턴 배율 (1턴:1, 2턴:1.1, 3턴:1.21)
    const turnMultiplier = Math.pow(1.1, turn - 1);

    // 🔥 TF 세기
    const [myT, myF] = countTF(myTF);
    const [enemyT, enemyF] = countTF(enemyTF);

    // =======================
    //  스킬 데미지
    // =======================
    const dmgMySkill = calcSkillDamage(
        mySkill,
        myT, myF,
        myCombat,
        myOrderWeight
    ) * turnMultiplier;

    const dmgEnemySkill = calcSkillDamage(
        enemySkill,
        enemyT, enemyF,
        enemyCombat,
        enemyOrderWeight
    ) * turnMultiplier;

    // =======================
    //  효과 데미지 (지속효과 누적)
    // =======================
    const dmgMyEffect = calcEffectDamage({
        AP: totalMy.AP,
        BP: totalMy.BP,
        AN: totalMy.AN,
        BN: totalMy.BN,
        mySupport,
        enemyCombat,
        skillTurns: mySkill?.turns ?? 1,
        isMyTurn: true,
        orderWeight: myOrderWeight
    }) * turnMultiplier;

    const dmgEnemyEffect = calcEffectDamage({
        AP: totalEnemy.AP,
        BP: totalEnemy.BP,
        AN: totalEnemy.AN,
        BN: totalEnemy.BN,
        mySupport: enemySupport,
        enemyCombat: myCombat,
        skillTurns: enemySkill?.turns ?? 1,
        isMyTurn: false,
        orderWeight: enemyOrderWeight
    }) * turnMultiplier;

    return {
        dmgToEnemy: dmgMySkill + dmgMyEffect,
        dmgToMe: dmgEnemySkill + dmgEnemyEffect,

        detail: {
            turn,
            my: {
                ...totalMy,
                skillDmg: dmgMySkill,
                effectDmg: dmgMyEffect,
                totalDmg: dmgMySkill + dmgMyEffect
            },
            enemy: {
                ...totalEnemy,
                skillDmg: dmgEnemySkill,
                effectDmg: dmgEnemyEffect,
                totalDmg: dmgEnemySkill + dmgEnemyEffect
            }
        }
    };
}


// =======================================
//  4. TF 카운터
// =======================================
function countTF(str) {
    let T = 0, F = 0;
    for (let c of str) c === "T" ? T++ : F++;
    return [T, F];
}


// =======================================
//  exports
// =======================================
module.exports = {
    pickRandom3Skills,
    calcOrderWeight,
    simulateTurn
};
