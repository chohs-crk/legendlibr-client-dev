const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");

const { admin, db } = require("../admin/admin");
const { makeTarot } = require("./maketarot");

// ✅ makeTarot 내부에서 GEMINI_API_KEY.value()를 쓰므로,
// ✅ 이 함수(트리거)에서 secrets로 명시해줘야 런타임에서 키가 안정적으로 주입됨.
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/**
 * ELO 계산 함수 (기존 로직 유지)
 */
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

exports.applyEloOnBattleFinish = onDocumentUpdated(
    {
        document: "battles/{battleId}",
        secrets: [GEMINI_API_KEY],
    },
    async (event) => {
        const after = event.data.after.data();
        if (!after?.finished) return;

        const battleRef = event.data.after.ref;

        // ✅ 조건 분리: ELO와 TAROT은 서로 막지 않게 분리한다.
        const needElo = after.eloApplied !== true;

        const needTarot =
            after.tarotEligible === true &&
            !after.tarotCreatedAt &&
            !after.tarotStatus;   // 🔥 status가 아예 없을 때만 실행


        // 둘 다 필요 없으면 종료
        if (!needElo && !needTarot) return;

        const { winnerId, loserId } = after;
        if (!winnerId || !loserId) return;

        const winnerRef = db.collection("characters").doc(winnerId);
        const loserRef = db.collection("characters").doc(loserId);

        // =========================
        // 1) ELO 적용 (필요할 때만)
        // =========================
        if (needElo) {
            try {
                await db.runTransaction(async (tx) => {
                    const battleSnap = await tx.get(battleRef);
                    const battle = battleSnap.data();

                    // 다른 실행이 먼저 eloApplied를 찍었으면 종료
                    if (battle?.eloApplied === true) return;

                    const winnerSnap = await tx.get(winnerRef);
                    const loserSnap = await tx.get(loserRef);

                    if (!winnerSnap.exists || !loserSnap.exists) return;

                    const winner = winnerSnap.data();
                    const loser = loserSnap.data();

                    const eloA = typeof winner.rankScore === "number" ? winner.rankScore : 1000;
                    const eloB = typeof loser.rankScore === "number" ? loser.rankScore : 1000;

                    const { win, lose } = calcEloDelta(eloA, eloB);
                    const winnerAfter = eloA + win;
                    const loserAfter = Math.max(0, eloB - lose);

                    tx.update(winnerRef, {
                        rankScore: winnerAfter,
                        lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),

                        // 🔥 battleCount 증가
                        battleCount: admin.firestore.FieldValue.increment(1),
                    });

                    tx.update(loserRef, {
                        rankScore: loserAfter,
                        lastBattleAt: admin.firestore.FieldValue.serverTimestamp(),

                        // 🔥 battleCount 증가
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
                            loserDelta: -lose
                        }
                    });

                });
            } catch (err) {
                console.error("[ELO_APPLY_FAIL]", err?.message || String(err));
                // ELO 실패해도 TAROT은 별개로 시도할지 여부는 정책에 따라 선택 가능.
                // 여기서는 "타로는 그대로 진행"하도록 둠.
            }
        }

        // =========================
        // 2) TAROT 생성 (필요할 때만)
        //    - 락을 먼저 잡아서 중복 생성 방지
        // =========================
        if (!needTarot) return;

        let lockedBattle = null;

        // (A) 락 잡기: tarotStatus="creating"을 트랜잭션으로 선점
        try {
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(battleRef);
                const battle = snap.data();

                // 조건 재확인 (경합 방지)
                if (!battle?.finished) return;
                if (battle?.tarotEligible !== true) return;
                if (battle?.tarotCreatedAt) return;
                if (battle?.tarotStatus === "creating") return;

                tx.update(battleRef, {
                    tarotStatus: "creating",
                    tarotRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                lockedBattle = battle; // 트랜잭션 밖에서 사용
            });
        } catch (err) {
            console.error("[TAROT_LOCK_FAIL]", err?.message || String(err));
            return;
        }

        // 락을 못 잡았으면(다른 실행이 먼저 잡았거나 조건 미충족) 종료
        if (!lockedBattle) return;

        // (B) 실제 생성
        try {
            // battleLog는 lockedBattle.finalNarration을 우선 사용
            // (after.finalNarration을 써도 되지만, 락 잡은 스냅샷 기준이 더 일관적)
            const battleLog = lockedBattle.finalNarration || "";

            // 캐릭터 정보는 최신으로 1회 읽기
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
            // 지명 포함 여부 검사
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



            // 안전 검증(형식 깨지면 저장 금지)
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

            // 실패 시 상태 남김 (재시도 정책을 위해 error 상태 저장)
            await battleRef.update({
                tarotStatus: "error",
                tarotError: err?.message || String(err),
            });
        }
    }
);
