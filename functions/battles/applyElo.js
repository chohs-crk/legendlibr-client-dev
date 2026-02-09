const { onDocumentUpdated } =
    require("firebase-functions/v2/firestore");

const { admin, db } = require("../admin/admin");

/**
 * ELO 계산 함수 (기존 로직 유지)
 */
function calcEloDelta(winnerElo, loserElo) {
    const BASE_K = 15;
    const MAX_K = 20;
    const DIFF_CAP = 200;

    const diff = Math.min(
        Math.abs(winnerElo - loserElo),
        DIFF_CAP
    );

    const baseDelta = Math.round(
        BASE_K + (diff / DIFF_CAP) * (MAX_K - BASE_K)
    );

    let bonusRate = 0;
    if (winnerElo <= 1500) bonusRate = 0.5;
    else if (winnerElo <= 2000) bonusRate = 0.3;
    else if (winnerElo <= 2500) bonusRate = 0.2;
    else if (winnerElo <= 3000) bonusRate = 0.1;

    const win = Math.round(baseDelta * (1 + bonusRate));
    const lose = baseDelta;

    return { win, lose };
}

exports.applyEloOnBattleFinish = onDocumentUpdated(
    "battles/{battleId}",
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();

        if (!after?.finished) return;
        if (after.eloApplied === true) return;

        const { winnerId, loserId } = after;
        if (!winnerId || !loserId) return;

        const battleRef = event.data.after.ref;
        const winnerRef = db.collection("characters").doc(winnerId);
        const loserRef = db.collection("characters").doc(loserId);

        await db.runTransaction(async (tx) => {
            const winnerSnap = await tx.get(winnerRef);
            const loserSnap = await tx.get(loserRef);

            if (!winnerSnap.exists || !loserSnap.exists) return;

            const winner = winnerSnap.data();
            const loser = loserSnap.data();

            const eloA =
                typeof winner.rankScore === "number"
                    ? winner.rankScore
                    : 1000;

            const eloB =
                typeof loser.rankScore === "number"
                    ? loser.rankScore
                    : 1000;

            const { win, lose } = calcEloDelta(eloA, eloB);

            tx.update(winnerRef, {
                rankScore: eloA + win,
                lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            tx.update(loserRef, {
                rankScore: Math.max(0, eloB - lose),
                lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            tx.update(battleRef, {
                eloApplied: true,
            });
        });
    }
);
