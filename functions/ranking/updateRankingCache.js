const admin = require("firebase-admin");
const { onSchedule } =
    require("firebase-functions/v2/scheduler");

admin.initializeApp();
const db = admin.firestore();

exports.updateRankingCache = onSchedule(
    "every 5 minutes",
    async () => {

        const now = Date.now();
        const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
        const cutoffDate = new Date(now - TWO_WEEKS_MS);

        const cutoffTimestamp =
            admin.firestore.Timestamp.fromDate(cutoffDate);

        // 1️⃣ 최근 2주 내 전투한 캐릭터만
        const snapshot = await db
            .collection("characters")
            
            .where("lastBattleAt", ">=", cutoffTimestamp)

            .orderBy("rankScore", "desc")
            .orderBy("lastBattleAt", "desc")

            
            .limit(100)
            .get();

        // 2️⃣ 랭킹 리스트 생성
        const rankingList = [];
        let rank = 1;

        snapshot.forEach((doc) => {
            const c = doc.data();

            rankingList.push({
                rank,
                charId: doc.id,
                name: c.displayRawName,
                rankScore: c.rankScore,
                imageUrl: c.image?.url || null
            });



            rank++;
        });

        // 3️⃣ 캐시 문서 저장
        await db
            .collection("rankingsCache")
            .doc("top100")
            .set({
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                list: rankingList,
            });
    }
);
