// functions/battle/processOneBattle.js

const fetch = require("node-fetch");
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

const OPENAI_KEY = defineSecret("OPENAI_KEY");


/* =========================================================
   🔥 AI 전투 로그 생성
========================================================= */

async function generateBattleNarration({
    my,
    enemy,
    myPicked,
    enemyPicked,
    turnLogs,
    winnerId
}) {

    const winnerName =
        winnerId === my.uid ? my.displayRawName : enemy.displayRawName;

    const userPrompt = buildUserPrompt({
        my,
        enemy,
        mySkills: myPicked,
        enemySkills: enemyPicked,
        openingType: pickOpening(),
        midResultType: evaluateBattleFlow(turnLogs),
        winnerName
    });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_KEY.value()}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.85,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ]
        })
    });

    const json = await res.json();
    return json?.choices?.[0]?.message?.content || "전투 기록 생성 실패.";
}


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

    let aiEval = await getSkillEvaluation(my, enemy);

    let myHP = calcHP(my.scores);
    let enemyHP = calcHP(enemy.scores);

    const myPicked = pickRandom3Skills(my.skills);
    const enemyPicked = pickRandom3Skills(enemy.skills);

    const myOrderWeight = calcOrderWeight(aiEval.myOrder, myPicked);
    const enemyOrderWeight = calcOrderWeight(aiEval.enemyOrder, enemyPicked);

    const turnLogs = [];

    for (let turn = 1; turn <= 3; turn++) {

        const result = simulateTurn({
            turn,
            mySkill: myPicked[turn - 1],
            enemySkill: enemyPicked[turn - 1],
            myTF: aiEval.myTF[myPicked.indexOf(myPicked[turn - 1])],
            enemyTF: aiEval.enemyTF[enemyPicked.indexOf(enemyPicked[turn - 1])],
            mySupport: my.scores.supportScore,
            enemySupport: enemy.scores.supportScore,
            myCombat: my.scores.combatScore,
            enemyCombat: enemy.scores.combatScore,
            myOrderWeight,
            enemyOrderWeight
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
