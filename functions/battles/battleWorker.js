const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../admin/admin");
const { processOneBattle } = require("./processOneBattle");

// 🔥 매 1분마다 실행
exports.battleWorker = onSchedule("every 1 minutes", async () => {
    try {
        console.log("[battleWorker] 실행 시작");

        // 🔥 총 12번 반복 (5초 × 12 = 60초)
        for (let i = 0; i < 12; i++) {

            console.log(`[battleWorker] 반복 ${i + 1}/12 실행`);

            // === 1) queued 전투 10개 가져오기 ===
            const snap = await db
                .collection("battles")
                .where("status", "==", "queued")
                .orderBy("createdAt", "asc")
                .limit(10)
                .get();

            if (!snap.empty) {
                const tasks = [];

                snap.forEach((doc) => {
                    const battleId = doc.id;
                    const data = doc.data();
                    tasks.push(processOneBattle(battleId, data));
                });

                // 병렬 실행
                await Promise.all(tasks);

                console.log(`[battleWorker] 이번 라운드 처리: ${tasks.length}개 완료`);
            } else {
                console.log("[battleWorker] 실행할 대기열 없음");
            }

            // === 2) 마지막 실행이 아니라면 5초 대기 ===
            if (i < 11) {
                await new Promise((r) => setTimeout(r, 5000));
            }
        }

        console.log("[battleWorker] 12회 반복 완료 후 종료");
        return null;

    } catch (e) {
        console.error("battleWorker error:", e);
        return null;
    }
});
