const { setGlobalOptions } = require("firebase-functions/v2");
setGlobalOptions({
    cpu: 1,
    maxInstances: 50,
    region: "asia-northeast3"
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
ERROR BATTLE CLEANUP
============================ */
exports.cleanupBattleErrors =
    require("./battles/cleanupBattleErrors")
        .cleanupBattleErrors;
/* ============================
BATTLE TRIGGER
============================ */
exports.onBattleCreated =
    require("./battles/battleTrigger")
        .onBattleCreated;
