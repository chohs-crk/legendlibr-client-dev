import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";

/* =========================================================
   텍스트 파서
========================================================= */
function parseStoryText(raw) {
    if (!raw) return "";
    let html = String(raw);

    html = html.replace(/story-(em|talk|skill)\"?>/gi, "");
    html = html.replace(/<span[^>]*>/gi, "");
    html = html.replace(/<\/span>/gi, "");
    html = html.replace(/&lt;\/?span[^&]*&gt;/gi, "");

    html = html.replace(/\*\*(.+?)\*\*/g, (_, txt) =>
        `<span class="story-em">${txt}</span>`
    );

    html = html.replace(/§([^§]+?)§/g, (_, txt) =>
        `"${'<span class="story-talk">' + txt + "</span>"}"`
    );

    html = html.replace(/『(.+?)』/g, (_, txt) =>
        `『<span class="story-skill">${txt}</span>』`
    );

    html = html.replace(/\r\n/g, "\n");
    html = html.replace(/\n{2,}/g, "<br><br>");
    html = html.replace(/\n/g, " ");

    return html.trim();
}

/* =========================================================
   캐시 처리
========================================================= */
function getCachedBattle(id) {
    const raw = sessionStorage.getItem("battleCacheMap");
    if (!raw) return null;

    try {
        const map = JSON.parse(raw);
        return map[id] || null;
    } catch {
        return null;
    }
}

function cacheBattle(battle) {
    const raw = sessionStorage.getItem("battleCacheMap");
    const map = raw ? JSON.parse(raw) : {};

    map[battle.id] = battle;

    sessionStorage.setItem("battleCacheMap", JSON.stringify(map));
}

/* =========================================================
   API 호출
========================================================= */
async function fetchBattleById(id, onlyLogs = false) {
    const url = onlyLogs
        ? `/base/battle-solo?id=${encodeURIComponent(id)}&onlyLogs=1`
        : `/base/battle-solo?id=${encodeURIComponent(id)}`;

    const res = await apiFetch(url);
    if (!res.ok) return null;

    return await res.json();
}

/* =========================================================
   렌더 함수
========================================================= */
function renderBattle(battle) {
    const container = document.getElementById("battleLogContainer");

    if (!container) return;

    const enemyImg = resolveCharImage(battle.enemyImage);
    const logs = battle.logs || [];

    const sections = logs.map(log => {
        const narration = log.text || "";
        return `
            <div class="battle-section">
                <div class="battle-text">
                    ${parseStoryText(narration)}
                </div>
            </div>
        `;
    });

    container.innerHTML = `
        <div class="battle-log-header">
            <img src="${enemyImg}" />
            <h2>${battle.enemyName || "전투"}</h2>
        </div>

        <div class="battle-log-body">
            ${sections.join("<hr>")}
        </div>
    `;
}

/* =========================================================
   페이지 초기화
========================================================= */
export async function initBattleLogPage(battleId) {
    const container = document.getElementById("battleLogContainer");

    if (!battleId) {
        battleId = sessionStorage.getItem("viewBattleId");
    }

    if (!battleId) {
        container.innerHTML = "<div>전투 기록이 없습니다.</div>";
        return;
    }

    let battle = getCachedBattle(battleId);

    /* =========================================================
       1️⃣ 캐릭터뷰 경유 (캐시 존재)
    ========================================================== */
    if (battle) {

        // 1단계: preview 먼저 렌더
        renderBattle(battle);

        // 2단계: logs만 서버에서 읽기
        const logsOnly = await fetchBattleById(battleId, true);

        if (logsOnly && logsOnly.logs) {
            battle.logs = logsOnly.logs;
            cacheBattle(battle);
            renderBattle(battle);
        }

        return;
    }

    /* =========================================================
       2️⃣ 공유 링크 직행
    ========================================================== */
    container.innerHTML = "<div>전투 기록 불러오는 중...</div>";

    battle = await fetchBattleById(battleId);

    if (!battle) {
        container.innerHTML = "<div>전투 기록을 불러올 수 없습니다.</div>";
        return;
    }

    cacheBattle(battle);
    renderBattle(battle);
}
