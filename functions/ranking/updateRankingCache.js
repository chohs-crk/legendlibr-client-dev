const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../admin/admin");

exports.updateRankingCache = onSchedule(
    "every 5 minutes",
    async () => {

        // 🔥 lastBattleAt 관련 모든 필터 제거
        const snapshot = await db
            .collection("characters")
            .orderBy("rankScore", "desc")
            .limit(100)
            .get();

        const rankingList = [];
        let rank = 1;

        snapshot.forEach((doc) => {
            const c = doc.data();

            rankingList.push({
                rank,
                charId: doc.id,
                name: c.displayRawName,
                rankScore: c.rankScore,
                image: c.image || null,     // ← base/preset용 전체 저장 권장
                imageUrl: c.image?.url || null,
            });

            rank++;
        });

        await db
            .collection("rankingsCache")
            .doc("top100")
            .set({
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                list: rankingList,
            });
    }
);

