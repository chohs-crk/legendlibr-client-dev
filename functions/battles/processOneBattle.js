// functions/battle/processOneBattle.js

const { admin, db } = require("../admin/admin");
const { getSkillEvaluation } = require("./aiSkillEval");

// 새로 추가된 계산/엔진 모듈
const { calcHP } = require("./calcBattle");
const { pickRandom3Skills, calcOrderWeight, simulateTurn } = require("./skillEngine");

/* =========================================================
   🔥 실제 3턴 배틀 엔진
========================================================= */
async function runBattleLogic(myId, enemyId) {
    // 캐릭터 문서 가져오기
    const mySnap = await db.collection("characters").doc(myId).get();
    const enemySnap = await db.collection("characters").doc(enemyId).get();

    if (!mySnap.exists || !enemySnap.exists) {
        throw new Error("캐릭터 정보를 가져올 수 없음");
    }

    const my = mySnap.data();
    const enemy = enemySnap.data();

    /* =========================================================
       🔥 AI 호출 (스킬 TF + 순서 추천)
    ========================================================== */
    let aiEval;
    try {
        aiEval = await getSkillEvaluation(my, enemy);
    } catch (err) {
        console.error("AI 호출 실패:", err);
        aiEval = {
            myTF: ["FFFFF", "FFFFF", "FFFFF"],
            enemyTF: ["FFFFF", "FFFFF", "FFFFF"],
            myOrder: "0123",
            enemyOrder: "0123"
        };
    }

    /* =========================================================
       🔥 HP 계산
    ========================================================== */
    let myHP = calcHP(my.scores);
    let enemyHP = calcHP(enemy.scores);

    /* =========================================================
       🔥 스킬 3개 랜덤 선택
    ========================================================== */
    const myPicked = pickRandom3Skills(my.skills);
    const enemyPicked = pickRandom3Skills(enemy.skills);

    /* =========================================================
       🔥 AI 추천 순서 기반 가중치 계산
    ========================================================== */
    const myOrderWeight = calcOrderWeight(aiEval.myOrder, myPicked);
    const enemyOrderWeight = calcOrderWeight(aiEval.enemyOrder, enemyPicked);

    /* =========================================================
       🔥 3턴 전투
    ========================================================== */
    const turnLogs = [];
    for (let turn = 1; turn <= 3; turn++) {
        const mySkill = myPicked[turn - 1];
        const enemySkill = enemyPicked[turn - 1];

        const turnResult = simulateTurn({
            turn,
            mySkill,
            enemySkill,
            myTF: aiEval.myTF[myPicked.indexOf(mySkill)],
            enemyTF: aiEval.enemyTF[enemyPicked.indexOf(enemySkill)],

            mySupport: my.scores.supportScore,
            enemySupport: enemy.scores.supportScore,
            myCombat: my.scores.combatScore,
            enemyCombat: enemy.scores.combatScore,
            myOrderWeight,
            enemyOrderWeight
        });

        // 데미지 적용
        enemyHP -= turnResult.dmgToEnemy;
        myHP -= turnResult.dmgToMe;
        // 🔥 턴 로그 저장
        turnLogs.push({
                    turn,
                       mySkill,
                       enemySkill,
                      my: {
              ...turnResult.detail.my,
                           hpAfter: myHP
                   },
               enemy: {
                       ...turnResult.detail.enemy,
                           hpAfter: enemyHP
                          }
           });
        // 죽었으면 즉시 종료
        if (myHP <= 0 || enemyHP <= 0) break;
    }

    /* =========================================================
       🔥 승자 판정
    ========================================================== */
    let winnerId, loserId;

    if (myHP > enemyHP) winnerId = myId;
    else if (enemyHP > myHP) winnerId = enemyId;
    else {
        // 둘다 같은 경우 → 랜덤
        winnerId = Math.random() < 0.5 ? myId : enemyId;
    }

    loserId = winnerId === myId ? enemyId : myId;

    /* =========================================================
       🔥 narration 로그 생성
    ========================================================== */
    return {
        winnerId,
        loserId,
        logs: [
            {
                skillAName: "전투 요약",
                narration:
                    `
내 캐릭터: ${my.promptRefined}
상대 캐릭터: ${enemy.promptRefined}

=========================
🔥 AI 스킬 TF 분석
=========================
내 TF: ${aiEval.myTF.join(" | ")}
상대 TF: ${aiEval.enemyTF.join(" | ")}

=========================
🔥 추천 스킬 순서
=========================
내 추천: ${aiEval.myOrder}
상대 추천: ${aiEval.enemyOrder}

=========================
🔥 전투 결과
=========================
내 HP: ${myHP.toFixed(2)}
상대 HP: ${enemyHP.toFixed(2)}

승자: ${winnerId === myId ? my.displayRawName : enemy.displayRawName}
패자: ${winnerId === myId ? enemy.displayRawName : my.displayRawName}
`
            }
        ],
        turnLogs, 
        myName: my.displayRawName || "",
        enemyName: enemy.displayRawName || ""
    };
}

/* =========================================================
   🔥 Firebase Worker에서 호출되는 엔트리포인트
   (battleId, battleData 구조 유지)
========================================================= */
exports.processOneBattle = async (battleId, battleData) => {
    const ref = db.collection("battles").doc(battleId);

    try {
        // 상태 → processing
        await ref.update({
            status: "processing",
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 전투 실행
        const result = await runBattleLogic(
            battleData.myId,
            battleData.enemyId
        );

        // 결과 저장
        await ref.update({
            status: "done",

            finished: true,
            winnerId: result.winnerId,
            loserId: result.loserId,
            eloApplied: false,

            logs: result.logs,
            turnLogs: result.turnLogs,
            myName: result.myName,
            enemyName: result.enemyName,

            result: {
                winnerId: result.winnerId,
                loserId: result.loserId
            },

            finishedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Battle #${battleId}] DONE → Winner: ${result.winnerId}`);

    } catch (e) {
        console.error("processOneBattle error:", e);

        await ref.update({
            status: "error",
            errorMsg: e.message
        });
    }
};
