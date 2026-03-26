const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../admin/admin");

exports.resetDailyBattle = onSchedule(
    {
        schedule: "0 0 * * *",
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
    },
    async () => {
        const snap = await db
            .collection("characters")
            .where("dailybattle", ">", 0)
            .get();

        if (snap.empty) {
            console.log("[RESET_DAILY_BATTLE] no characters to reset");
            return;
        }

        const docs = snap.docs;
        const chunkSize = 400;
        let updatedCount = 0;

        for (let i = 0; i < docs.length; i += chunkSize) {
            const batch = db.batch();
            const chunk = docs.slice(i, i + chunkSize);

            for (const doc of chunk) {
                batch.update(doc.ref, {
                    dailybattle: 0,
                    dailybattleResetAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            await batch.commit();
            updatedCount += chunk.length;
        }

        console.log(`[RESET_DAILY_BATTLE] reset ${updatedCount} characters`);
    }
);
