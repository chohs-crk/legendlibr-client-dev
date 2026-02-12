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

// 🔥 수정 1: 순서 가중치 로직 정상화
function calcOrderWeight(aiOrder, pickedIdxs) {
    // pickedIdxs는 [0, 1, 3] 같은 배열임
    const pickedStr = pickedIdxs.join("");

    // 1. 완전 일치 (1.2): AI 추천의 앞부분과 정확히 일치 (예: AI "0132" / 유저 "013")
    if (aiOrder.startsWith(pickedStr)) return 1.2;

    // 2. 부분 일치 (1.1): 순서가 어느 정도 맞는 경우 (최소 2개 이상의 상대적 순서 일치)
    let hit = 0;
    for (let i = 0; i < pickedIdxs.length - 1; i++) {
        // 현재 스킬이 다음 스킬보다 AI 추천 순서에서 앞에 있는지 확인
        if (aiOrder.indexOf(pickedIdxs[i]) < aiOrder.indexOf(pickedIdxs[i + 1])) {
            hit++;
        }
    }
    if (hit >= 1) return 1.1;

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

// 🔥 수정 2: Aura 상태를 외부(context)에서 받아 처리하도록 변경
function updateAura(currentTurn, context) {
    context.aura = {
        my: { AP: 0, BP: 0, AN: 0, BN: 0 },
        enemy: { AP: 0, BP: 0, AN: 0, BN: 0 }
    };

    for (const item of context.auraQueue) {
        const diff = currentTurn - item.usedTurn;
        if (diff < 0 || diff >= item.skill.turns) continue;

        const vals = getImpactValues(item.skill, item.usedTurn, currentTurn, item.caster === "my");

        context.aura[item.caster].AP += vals.AP;
        context.aura[item.caster].BP += vals.BP;
        context.aura[item.caster].AN += vals.AN;
        context.aura[item.caster].BN += vals.BN;
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
    enemyOrderWeight,
    context
}) {
  


    if (mySkill) context.auraQueue.push({ caster: "my", skill: mySkill, usedTurn: turn });
    if (enemySkill) context.auraQueue.push({ caster: "enemy", skill: enemySkill, usedTurn: turn });

    updateAura(turn, context);

    const totalMy = context.aura.my;
    const totalEnemy = context.aura.enemy;

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
