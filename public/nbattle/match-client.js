import { apiFetch } from "/base/api.js";


export async function checkBattleMatch() {
    const charId = sessionStorage.getItem("battleCharId");
    if (!charId) throw new Error("NO_BATTLE_CHAR");

    const cacheKey = `battleMatchCache:${charId}`;

    const cacheRaw = sessionStorage.getItem(cacheKey);

    const FIVE_MIN = 5 * 60 * 1000;

    if (cacheRaw) {
        try {
            const cache = JSON.parse(cacheRaw);

            // ✅ TTL 검사
            if (cache.savedAt && Date.now() - cache.savedAt < FIVE_MIN) {
                return {
                    matched: true,
                    myChar: { id: charId },
                    enemyChar: cache.enemyChar,
                    cached: true
                };
            }

            // ⛔ 만료된 캐시는 제거
            sessionStorage.removeItem(cacheKey);

        } catch {
            sessionStorage.removeItem(cacheKey);
        }
    }


    // 🔥 캐시 없으면 API 호출
    const res = await apiFetch("/battle/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charId })
    });

    if (!res.ok) throw new Error("MATCH_API_FAIL");

    const data = await res.json();

    if (data.matched) {
        sessionStorage.setItem(
            cacheKey,
            JSON.stringify({
                enemyChar: data.enemyChar,
                savedAt: Date.now()
            })
        );
    }

    return data;
}
