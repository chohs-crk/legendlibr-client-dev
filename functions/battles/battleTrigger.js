const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { admin, db } = require("../admin/admin");
const { processOneBattle } = require("./processOneBattle");

const MAX_CONCURRENT = 8;

/* ======================================================
   🔥 동시 실행 체크 후 실행
====================================================== */

async function tryStartBattle(battleId) {

    const battleRef = db.collection("battles").doc(battleId);

    // 1️⃣ 현재 processing 개수 확인
    const processingSnap = await db
        .collection("battles")
        .where("status", "==", "processing")
        .get();

    const runningCount = processingSnap.size;

    if (runningCount >= MAX_CONCURRENT) {
        return;
    }

    // 2️⃣ status를 트랜잭션으로 안전하게 변경
    const started = await db.runTransaction(async (tx) => {

        const snap = await tx.get(battleRef);
        if (!snap.exists) return false;

        const data = snap.data();
        if (data.status !== "queued") return false;

        tx.update(battleRef, {
            status: "processing",
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return true;
    });

    if (!started) return;

    executeBattle(battleId);
}

/* ======================================================
   🔥 실제 실행
====================================================== */

async function executeBattle(battleId) {

    const battleRef = db.collection("battles").doc(battleId);

    try {

        const snap = await battleRef.get();
        const data = snap.data();

        if (!data || data.status !== "processing") return;

        await processOneBattle(battleId, data);

    } finally {

        // 🔥 다음 queued 자동 실행
        await startNextQueued();
    }
}

/* ======================================================
   🔥 대기열 처리
====================================================== */

async function startNextQueued() {

    const processingSnap = await db
        .collection("battles")
        .where("status", "==", "processing")
        .get();

    if (processingSnap.size >= MAX_CONCURRENT) {
        return;
    }

    const queuedSnap = await db
        .collection("battles")
        .where("status", "==", "queued")
        .orderBy("createdAt", "asc")
        .limit(1)
        .get();

    if (queuedSnap.empty) return;

    const doc = queuedSnap.docs[0];
    await tryStartBattle(doc.id);
}

/* ======================================================
   🔥 Firestore onCreate 트리거
====================================================== */
const { defineSecret } = require("firebase-functions/params");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
exports.onBattleCreated = onDocumentCreated(
    {
        document: "battles/{battleId}",
        secrets: [GEMINI_API_KEY],
    },
    async (event) => {

        const battleId = event.params.battleId;
        const data = event.data.data();

        if (!data || data.status !== "queued") return;

        await tryStartBattle(battleId);
    }
);
