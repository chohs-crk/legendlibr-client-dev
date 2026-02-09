import { apiFetch } from "/base/api.js";

/*
  battle 진입 시 호출
  - 매칭 상태 확인
  - enemyId 있으면 그대로 사용
*/
export async function checkBattleMatch() {
    const charId = sessionStorage.getItem("battleCharId");

    if (!charId) {
        throw new Error("NO_BATTLE_CHAR");
    }

    const res = await apiFetch("/battle/match", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ charId })
    });


    if (!res.ok) {
        throw new Error("MATCH_API_FAIL");
    }

    return res.json();
}
