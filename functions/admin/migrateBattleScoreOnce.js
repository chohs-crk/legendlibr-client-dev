const admin = require("firebase-admin");
const { onRequest } =
    require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();

exports.migrateBattleScoreOnce = onRequest(async (req, res) => {
    const snap = await db.collection("characters").get();

    const batch = db.batch();
    let migrated = 0;

    snap.forEach((doc) => {
        const d = doc.data();

        if (
            typeof d.battleScore === "number" &&
            typeof d.rankScore !== "number"
        ) {
            batch.update(doc.ref, {
                rankScore: d.battleScore,
                lastBattleAt: d.createdAt
                    || admin.firestore.FieldValue.serverTimestamp(),
                battleScore: admin.firestore.FieldValue.delete(),
            });
            migrated++;
        }
    });

    await batch.commit();

    res.json({
        migrated,
        status: "done"
    });
});
