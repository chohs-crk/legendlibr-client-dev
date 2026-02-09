// functions/battle/processOneBattle.js
const { admin, db } = require("../admin/admin");

async function runBattleLogic(myId, enemyId) {
    // 캐릭터 문서 가져오기
    const mySnap = await db.collection("characters").doc(myId).get();
    const enemySnap = await db.collection("characters").doc(enemyId).get();

    if (!mySnap.exists || !enemySnap.exists) {
        throw new Error("캐릭터 정보를 가져올 수 없음");
    }

    const my = mySnap.data();
    const enemy = enemySnap.data();

    const myScore = my?.scores?.narrativeScore ?? 0;
    const enemyScore = enemy?.scores?.narrativeScore ?? 0;

    let winnerId, loserId;

    if (myScore > enemyScore) {
        winnerId = myId;
        loserId = enemyId;
    } else if (enemyScore > myScore) {
        winnerId = enemyId;
        loserId = myId;
    } else {
        // 동점 → 랜덤
        winnerId = Math.random() < 0.5 ? myId : enemyId;
        loserId = winnerId === myId ? enemyId : myId;
    }

    // logs에 대신 넣을 promptRefined 준비
    const myPrompt = my.promptRefined || "";
    const enemyPrompt = enemy.promptRefined || "";

    return {
        winnerId,
        loserId,
        logs: [
            {
                skillAName: "전투 요약",
                narration: `내 캐릭터: ${myPrompt}\n상대 캐릭터: ${enemyPrompt}`

               
            }
        ],
        myName: my.displayRawName || "",
        enemyName: enemy.displayRawName || ""
    };

}

exports.processOneBattle = async (battleId, battleData) => {
    const ref = db.collection("battles").doc(battleId);

    try {
        // 🔥 상태 변경
        await ref.update({
            status: "processing",
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 🔥 myId / enemyId 기반으로 전투 수행
        const result = await runBattleLogic(
            battleData.myId,      // ⬅ 수정됨
            battleData.enemyId
        );

        // 🔥 결과 저장 (applyElo가 읽는 필드 포함)
        await ref.update({
            status: "done",

            finished: true,
            winnerId: result.winnerId,
            loserId: result.loserId,
            eloApplied: false,

            logs: result.logs,
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
