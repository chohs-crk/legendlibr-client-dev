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
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
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
        const { winnerId, loserId, myId } = after;

        if (!winnerId || !loserId || !myId) return;

        const winnerRef = db.collection("characters").doc(winnerId);
        const loserRef = db.collection("characters").doc(loserId);
        const myRef = db.collection("characters").doc(myId);

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

                    if (!winnerSnap.exists || !loserSnap.exists) return;

                    const winner = winnerSnap.data() || {};
                    const loser = loserSnap.data() || {};

                    const eloA = typeof winner.rankScore === "number" ? winner.rankScore : 1000;
                    const eloB = typeof loser.rankScore === "number" ? loser.rankScore : 1000;

                    const { win, lose } = calcEloDelta(eloA, eloB);
                    const winnerAfter = eloA + win;
                    const loserAfter = Math.max(0, eloB - lose);

                    tx.update(winnerRef, {
                        rankScore: winnerAfter,
                        lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),
                        battleCount: admin.firestore.FieldValue.increment(1),
                    });

                    tx.update(loserRef, {
                        rankScore: loserAfter,
                        lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),
                        battleCount: admin.firestore.FieldValue.increment(1),
                    });

                    tx.update(battleRef, {
                        eloApplied: true,
                        eloAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
                        elo: {
                            winnerBefore: eloA,
                            winnerAfter,
                            winnerDelta: win,
                            loserBefore: eloB,
                            loserAfter,
                            loserDelta: -lose,
                        },
                    });
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
            !latestBattle.tarotCreatedAt &&
            !latestBattle.tarotStatus;

        if (!needTarot) return;

        let lockedBattle = null;
        let myDailyBattleBefore = 0;

        try {
            await db.runTransaction(async (tx) => {
                const [battleSnap, mySnap] = await Promise.all([
                    tx.get(battleRef),
                    tx.get(myRef),
                ]);

                const battle = battleSnap.data();
                const my = mySnap.exists ? (mySnap.data() || {}) : {};

                if (!battle?.finished) return;
                if (battle?.tarotEligible !== true) return;
                if (battle?.tarotCreatedAt) return;
                if (battle?.tarotStatus) return;

                myDailyBattleBefore = toSafeDailyBattle(my.dailybattle);
                const tarotDailyEligible = myDailyBattleBefore < 3;

                if (!tarotDailyEligible) {
                    tx.update(battleRef, {
                        tarotDailyEligible: false,
                        tarotStatus: "skipped_daily_limit",
                        tarotSkippedAt: admin.firestore.FieldValue.serverTimestamp(),
                        tarotError: admin.firestore.FieldValue.delete(),
                        dailybattleSnapshot: {
                            myBefore: myDailyBattleBefore,
                            myAfter: myDailyBattleBefore,
                        },
                    });
                    return;
                }

                tx.update(battleRef, {
                    tarotDailyEligible: true,
                    tarotStatus: "creating",
                    tarotRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
                    tarotError: admin.firestore.FieldValue.delete(),
                    dailybattleSnapshot: {
                        myBefore: myDailyBattleBefore,
                        myAfter: myDailyBattleBefore,
                    },
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
                loser.region,
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

            if (!tarotResult.myTarot || !tarotResult.enemyTarot) {
                throw new Error("TAROT_INVALID_FORMAT");
            }

            await db.runTransaction(async (tx) => {
                const [battleSnap, mySnap] = await Promise.all([
                    tx.get(battleRef),
                    tx.get(myRef),
                ]);

                const battle = battleSnap.data();
                const my = mySnap.exists ? (mySnap.data() || {}) : {};

                if (!battle?.finished) {
                    throw new Error("BATTLE_NOT_FINISHED");
                }
                if (battle?.tarotCreatedAt) {
                    return;
                }
                if (battle?.tarotStatus !== "creating") {
                    throw new Error("TAROT_LOCK_LOST");
                }

                const myDailyBattleCurrent = toSafeDailyBattle(my.dailybattle);

                tx.update(battleRef, {
                    tarot: {
                        winner: tarotResult.myTarot,
                        loser: tarotResult.enemyTarot,
                    },
                    tarotCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    tarotStatus: "done",
                    tarotError: admin.firestore.FieldValue.delete(),
                    tarotDailyEligible: true,
                    dailybattleSnapshot: {
                        myBefore: myDailyBattleBefore,
                        myAfter: myDailyBattleCurrent + 1,
                    },
                });

                tx.update(myRef, {
                    dailybattle: admin.firestore.FieldValue.increment(1),
                });
            });
        } catch (err) {
            console.error("[TAROT_FAIL]", err?.message || String(err));

            await battleRef.update({
                tarotStatus: "error",
                tarotError: err?.message || String(err),
                tarotDailyEligible: true,
                dailybattleSnapshot: {
                    myBefore: myDailyBattleBefore,
                    myAfter: myDailyBattleBefore,
                },
            });
        }
    }
);
