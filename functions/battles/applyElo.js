const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");

const { admin, db } = require("../admin/admin");
const { makeTarot } = require("./maketarot");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function calcEloDelta(winnerElo, loserElo) {
    const BASE_K = 15;
    const MAX_K = 20;
    const DIFF_CAP = 200;

    const diff = Math.min(Math.abs(winnerElo - loserElo), DIFF_CAP);

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

function toSafeDailyBattle(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

exports.applyEloOnBattleFinish = onDocumentUpdated(
    {
        document: "battles/{battleId}",
        secrets: [GEMINI_API_KEY],
    },
    async (event) => {
        const after = event.data.after.data();
        if (!after?.finished) return;

        const battleRef = event.data.after.ref;
        const { winnerId, loserId, myId, enemyId } = after;

        if (!winnerId || !loserId || !myId || !enemyId) return;

        const winnerRef = db.collection("characters").doc(winnerId);
        const loserRef = db.collection("characters").doc(loserId);
        const myRef = db.collection("characters").doc(myId);
        const enemyRef = db.collection("characters").doc(enemyId);

        const needElo = after.eloApplied !== true;

        if (needElo) {
            try {
                await db.runTransaction(async (tx) => {
                    const battleSnap = await tx.get(battleRef);
                    const battle = battleSnap.data();

                    if (!battle?.finished) return;
                    if (battle?.eloApplied === true) return;

                    const winnerSnap = await tx.get(winnerRef);
                    const loserSnap = await tx.get(loserRef);
                    const mySnap = await tx.get(myRef);
                    const enemySnap = await tx.get(enemyRef);

                    if (!winnerSnap.exists || !loserSnap.exists || !mySnap.exists || !enemySnap.exists) {
                        return;
                    }

                    const winner = winnerSnap.data() || {};
                    const loser = loserSnap.data() || {};
                    const my = mySnap.data() || {};

                    const eloA = typeof winner.rankScore === "number" ? winner.rankScore : 1000;
                    const eloB = typeof loser.rankScore === "number" ? loser.rankScore : 1000;

                    const { win, lose } = calcEloDelta(eloA, eloB);
                    const winnerAfter = eloA + win;
                    const loserAfter = Math.max(0, eloB - lose);

                    const myDailyBattleBefore = toSafeDailyBattle(my.dailybattle);
                    const myDailyBattleAfter = myDailyBattleBefore + 1;
                    const tarotDailyEligible = myDailyBattleBefore < 3;

                    const winnerUpdate = {
                        rankScore: winnerAfter,
                        lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),
                        battleCount: admin.firestore.FieldValue.increment(1),
                    };

                    const loserUpdate = {
                        rankScore: loserAfter,
                        lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),
                        battleCount: admin.firestore.FieldValue.increment(1),
                    };

                    if (winnerId === myId) {
                        winnerUpdate.dailybattle = myDailyBattleAfter;
                    }

                    if (loserId === myId) {
                        loserUpdate.dailybattle = myDailyBattleAfter;
                    }

                    tx.update(winnerRef, winnerUpdate);
                    tx.update(loserRef, loserUpdate);

                    const battleUpdate = {
                        eloApplied: true,
                        eloAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
                        tarotDailyEligible,
                        dailybattleSnapshot: {
                            myBefore: myDailyBattleBefore,
                            myAfter: myDailyBattleAfter,
                        },
                        elo: {
                            winnerBefore: eloA,
                            winnerAfter,
                            winnerDelta: win,

                            loserBefore: eloB,
                            loserAfter,
                            loserDelta: -lose
                        }
                    };

                    if (battle?.tarotEligible === true && !battle?.tarotCreatedAt && myDailyBattleBefore >= 3) {
                        battleUpdate.tarotStatus = "skipped_daily_limit";
                        battleUpdate.tarotSkippedAt = admin.firestore.FieldValue.serverTimestamp();
                        battleUpdate.tarotError = admin.firestore.FieldValue.delete();
                    }

                    tx.update(battleRef, battleUpdate);
                });
            } catch (err) {
                console.error("[ELO_APPLY_FAIL]", err?.message || String(err));
            }
        }

        const latestBattleSnap = await battleRef.get();
        const latestBattle = latestBattleSnap.data();
        if (!latestBattle?.finished) return;

        const needTarot =
            latestBattle.tarotEligible === true &&
            latestBattle.tarotDailyEligible !== false &&
            !latestBattle.tarotCreatedAt &&
            !latestBattle.tarotStatus;

        if (!needTarot) return;

        let lockedBattle = null;

        try {
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(battleRef);
                const battle = snap.data();

                if (!battle?.finished) return;
                if (battle?.tarotEligible !== true) return;
                if (battle?.tarotDailyEligible === false) return;
                if (battle?.tarotCreatedAt) return;
                if (battle?.tarotStatus) return;

                tx.update(battleRef, {
                    tarotStatus: "creating",
                    tarotRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                lockedBattle = battle;
            });
        } catch (err) {
            console.error("[TAROT_LOCK_FAIL]", err?.message || String(err));
            return;
        }

        if (!lockedBattle) return;

        try {
            const battleLog = lockedBattle.finalNarration || "";

            const [winnerSnap, loserSnap] = await Promise.all([
                winnerRef.get(),
                loserRef.get(),
            ]);

            const winner = winnerSnap.data() || {};
            const loser = loserSnap.data() || {};

            const tarotResult = await makeTarot({
                myIntro: winner.promptRefined || "",
                enemyIntro: loser.promptRefined || "",
                battleLog,
                winnerName: winner.displayRawName || "",

                myOriginName: winner.origin || "",
                myRegionName: winner.region || "",

                enemyOriginName: loser.origin || "",
                enemyRegionName: loser.region || "",
            });

            const forbidden = [
                winner.origin,
                winner.region,
                loser.origin,
                loser.region
            ].filter(Boolean);

            if (!tarotResult || typeof tarotResult !== "object") {
                throw new Error("TAROT_INVALID_FORMAT");
            }

            if (
                typeof tarotResult.myTarot !== "string" ||
                typeof tarotResult.enemyTarot !== "string"
            ) {
                throw new Error("TAROT_INVALID_FORMAT");
            }

            for (const word of forbidden) {
                if (
                    tarotResult.myTarot.includes(word) ||
                    tarotResult.enemyTarot.includes(word)
                ) {
                    throw new Error("TAROT_FORBIDDEN_NAME_USED");
                }
            }

            if (
                tarotResult.myTarot.length >= 12 ||
                tarotResult.enemyTarot.length >= 12
            ) {
                throw new Error("TAROT_TOO_LONG");
            }

            if (!tarotResult?.myTarot || !tarotResult?.enemyTarot) {
                throw new Error("TAROT_INVALID_FORMAT");
            }

            await battleRef.update({
                tarot: {
                    winner: tarotResult.myTarot,
                    loser: tarotResult.enemyTarot,
                },
                tarotCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
                tarotStatus: "done",
                tarotError: admin.firestore.FieldValue.delete(),
            });
        } catch (err) {
            console.error("[TAROT_FAIL]", err?.message || String(err));

            await battleRef.update({
                tarotStatus: "error",
                tarotError: err?.message || String(err),
            });
        }
    }
);
