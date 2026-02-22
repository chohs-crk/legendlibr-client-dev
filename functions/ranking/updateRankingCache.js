const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../admin/admin");

exports.updateRankingCache = onSchedule(
    {
        schedule: "*/5 * * * *",
        timeZone: "Asia/Seoul"
    },
    async () => {

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
                elo: c.rankScore,              // 🔥 추가
                battleCount: c.battleCount || 0,

                image: c.image || null,
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