// functions/battle/processOneBattle.js

const { GoogleGenerativeAI } = require("@google/generative-ai"); // 🔥 추가
const { defineSecret } = require("firebase-functions/params");
const { admin, db } = require("../admin/admin");

const { getSkillEvaluation } = require("./aiSkillEval");
const { calcHP } = require("./calcBattle");
const { pickRandom3Skills, calcOrderWeight, simulateTurn } = require("./skillEngine");

const {
    SYSTEM_PROMPT,
    buildUserPrompt,
    evaluateBattleFlow,
    pickOpening
} = require("./battleNarrationPrompt");

// 🔥 OpenAI 키 대신 Gemini 키 정의
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/* =========================================================
   🔥 AI 전투 로그 생성 (Gemini 버전)
========================================================= */

async function generateBattleNarration({
    my,
    enemy,
    myPicked,
    enemyPicked,
    turnLogs,
    winnerId
}) {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) throw new Error("Gemini API KEY is missing!");

    // SDK 설정
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-3.0-flash-lite"
    });

    const winnerName = winnerId === my.uid ? my.displayRawName : enemy.displayRawName;

    const userPrompt = buildUserPrompt({
        my,
        enemy,
        mySkills: myPicked,
        enemySkills: enemyPicked,
        openingType: pickOpening(),
        midResultType: evaluateBattleFlow(turnLogs),
        winnerName
    });

    // Gemini 호출 방식 (SDK 사용)
    const result = await model.generateContent({
        contents: [
            { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] }
        ],
        generationConfig: {
            temperature: 0.85,
        }
    });

    const response = await result.response;
    return response.text() || "전투 기록 생성 실패.";
}

// ... runBattleLogic 및 processOneBattle exports 로직은 동일


/* =========================================================
   🔥 실제 전투 로직
========================================================= */

async function runBattleLogic(myId, enemyId) {

    const mySnap = await db.collection("characters").doc(myId).get();
    const enemySnap = await db.collection("characters").doc(enemyId).get();

    if (!mySnap.exists || !enemySnap.exists)
        throw new Error("캐릭터 정보를 가져올 수 없음");

    const my = mySnap.data();
    const enemy = enemySnap.data();

    // 1. AI에게 4개 스킬 기반 평가 요청
    let aiEval = await getSkillEvaluation(my, enemy);

    // 2. 4개 중 3개 랜덤 추출
    const myPicked = pickRandom3Skills(my.skills);
    const enemyPicked = pickRandom3Skills(enemy.skills);

    // 🔥 핵심 수정: 뽑힌 3개 스킬이 '원래 4개 중 몇 번'이었는지 인덱스 배열 생성
    // 예: [스킬A, 스킬B, 스킬D]가 뽑혔다면 [0, 1, 3]이 됨
    const myPickedIndices = myPicked.map(p => my.skills.findIndex(s => s.name === p.name));
    const enemyPickedIndices = enemyPicked.map(p => enemy.skills.findIndex(s => s.name === p.name));

    // 3. 순서 가중치 계산 (인덱스 배열을 넘겨줌)
    const myOrderWeight = calcOrderWeight(aiEval.myOrder, myPickedIndices);
    const enemyOrderWeight = calcOrderWeight(aiEval.enemyOrder, enemyPickedIndices);
    // 🔥 핵심 수정 1: HP 변수 초기화
    let myHP = calcHP(my.scores);
    let enemyHP = calcHP(enemy.scores);

    // 🔥 핵심 수정 2: 배틀마다 독립적인 auraQueue 생성 (전역 변수 오염 방지)
    const context = {
        auraQueue: [],
        aura: {
            my: { AP: 0, BP: 0, AN: 0, BN: 0 },
            enemy: { AP: 0, BP: 0, AN: 0, BN: 0 }
        }
    };
    const turnLogs = [];
    for (let turn = 1; turn <= 3; turn++) {
        const result = simulateTurn({
            turn,
            mySkill: myPicked[turn - 1],
            enemySkill: enemyPicked[turn - 1],
            // 🔥 수정: 원래 인덱스를 사용하여 정확한 TF 매칭
            myTF: aiEval.myTF[myPickedIndices[turn - 1]],
            enemyTF: aiEval.enemyTF[enemyPickedIndices[turn - 1]],
            mySupport: my.scores.supportScore,
            enemySupport: enemy.scores.supportScore,
            myCombat: my.scores.combatScore,
            enemyCombat: enemy.scores.combatScore,
            myOrderWeight,
            enemyOrderWeight,
            context // 🔥 배틀 상태 전달
        });

        enemyHP -= result.dmgToEnemy;
        myHP -= result.dmgToMe;

        turnLogs.push({
            turn,
            my: { ...result.detail.my, hpAfter: myHP },
            enemy: { ...result.detail.enemy, hpAfter: enemyHP }
        });

        if (myHP <= 0 || enemyHP <= 0) break;
    }

    let winnerId;

    if (myHP > enemyHP) winnerId = myId;
    else if (enemyHP > myHP) winnerId = enemyId;
    else winnerId = Math.random() < 0.5 ? myId : enemyId;

    const loserId = winnerId === myId ? enemyId : myId;

    const narration = await generateBattleNarration({
        my,
        enemy,
        myPicked,
        enemyPicked,
        turnLogs,
        winnerId
    });

    return {
        winnerId,
        loserId,
        narration,
        turnLogs,
        myName: my.displayRawName,
        enemyName: enemy.displayRawName
    };
}


/* =========================================================
   🔥 Worker 엔트리포인트
========================================================= */

exports.processOneBattle = async (battleId, battleData) => {

    const ref = db.collection("battles").doc(battleId);

    try {

        await ref.update({
            status: "processing",
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const result = await runBattleLogic(
            battleData.myId,
            battleData.enemyId
        );

        await ref.update({
            status: "done",
            finished: true,
            winnerId: result.winnerId,
            loserId: result.loserId,
            eloApplied: false,

            logs: [
                {
                    skillAName: "전투 로그",
                    narration: result.narration
                }
            ],

            turnLogs: result.turnLogs,
            myName: result.myName,
            enemyName: result.enemyName,

            finishedAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (e) {

        await ref.update({
            status: "error",
            errorMsg: e.message
        });
    }
};
