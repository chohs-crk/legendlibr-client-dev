const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({
    maxInstances: 10,
});

/* ============================
   BATTLE ELO 처리
============================ */
exports.applyEloOnBattleFinish =
    require("./battles/applyElo")
        .applyEloOnBattleFinish;

/* ============================
   랭킹 캐시 업데이트
============================ */
exports.updateRankingCache =
    require("./ranking/updateRankingCache")
        .updateRankingCache;

/* ============================
   🔥 전투 워커 (1분 → 내부 5초 x 12회)
============================ */
exports.battleWorker =
    require("./battles/battleWorker")
        .battleWorker;
