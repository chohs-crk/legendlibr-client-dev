// functions/battle/processOneBattle.js

const { admin, db } = require("../admin/admin");
const { getSkillEvaluation } = require("./ai/aiSkillEval");

/* =========================================================
   🔥 배틀 실행 메인 로직 (임시 = TF/순서만 로그에 기록)
   - 이후 단계에서 체력/데미지/3턴 전투 엔진 추가 예정
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
       🔥 AI 호출: 스킬 T/F 판단 + 스킬 추천 순서
    ========================================================== */
    let aiEval;
    try {
        aiEval = await getSkillEvaluation(my, enemy);
    } catch (err) {
        console.error("AI 호출 실패:", err);
        aiEval = {
            myTF: [],
            enemyTF: [],
            myOrder: "0000",
            enemyOrder: "0000",
        };
    }

    /* =========================================================
       🔥 임시 승패 판단 (서사 점수 비교)
       (추후 HP/데미지 기반 3턴 엔진으로 교체 예정)
    ========================================================== */
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

    /* =========================================================
       🔥 narration 로그 생성
    ========================================================== */
    const myPrompt = my.promptRefined || "";
    const enemyPrompt = enemy.promptRefined || "";

    return {
        winnerId,
        loserId,
        logs: [
            {
                skillAName: "전투 요약",
                narration:
                    `내 캐릭터: ${myPrompt}
상대 캐릭터: ${enemyPrompt}

=========================
🔥 AI 스킬 적합성 분석
=========================
내 스킬 TF 평가:
${aiEval.myTF.join(" | ")}

상대 스킬 TF 평가:
${aiEval.enemyTF.join(" | ")}

=========================
🔥 추천 스킬 사용 순서
=========================
내 추천 순서: ${aiEval.myOrder}
상대 추천 순서: ${aiEval.enemyOrder}
`
            }
        ],
        myName: my.displayRawName || "",
        enemyName: enemy.displayRawName || ""
    };

}

/* =========================================================
   🔥 Firebase Worker에서 호출되는 엔트리 포인트
========================================================= */
exports.processOneBattle = async (battleId, battleData) => {
    const ref = db.collection("battles").doc(battleId);

    try {
        // 상태 변경
        await ref.update({
            status: "processing",
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 핵심 전투 로직 수행
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
