const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../admin/admin");

exports.cleanupBattleErrors = onSchedule(
    {
        schedule: "every 10 minutes",
        timeZone: "Asia/Seoul",
    },
    async () => {

        const snap = await db
            .collection("battles")
            .where("status", "==", "error")
            .get();

        if (snap.empty) return;

        const batch = db.batch();

        snap.docs.forEach(doc => {
            const data = doc.data();

            // 🔥 안전장치: finished true는 삭제 안 함
            if (data.finished === true) return;

            batch.delete(doc.ref);
        });

        await batch.commit();

        console.log(
            `[CLEANUP_ERROR_BATTLES] Deleted ${snap.size} error battles`
        );
    }
);
