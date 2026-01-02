const { setGlobalOptions } =
    require("firebase-functions/v2");

/**
 * 전역 옵션 (딱 1번만)
 */
setGlobalOptions({
    maxInstances: 10,
});

/**
 * Cloud Functions export
 */
exports.applyEloOnBattleFinish =
    require("./battles/applyElo")
        .applyEloOnBattleFinish;

exports.updateRankingCache =
    require("./ranking/updateRankingCache")
        .updateRankingCache;
