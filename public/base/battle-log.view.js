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
function connectBattleStream(battleId) {
    const es = new EventSource(`/battle/battle-stream?id=${battleId}`);

    es.onmessage = (e) => {
        const data = JSON.parse(e.data);

        // logs 업데이트
        if (data.logs) {
            const cached = getCachedBattle(battleId) || {};
            cached.logs = data.logs;
            cached.status = data.status;
            cached.winnerId = data.winnerId;
            cached.loserId = data.loserId;

            cacheBattle(cached);
            renderBattle(cached);
        }

        if (data.finished) {
            es.close();
        }
    };

    es.onerror = () => {
        es.close();
    };
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
function formatBattleResult(battle) {
    const myId =
        sessionStorage.getItem("viewCharId") ||
        new URLSearchParams(location.search).get("charId");

    if (!battle.winnerId) {
        return { text: "진행중", class: "neutral" };
    }

    if (battle.winnerId === myId) {
        return { text: "승", class: "win" };
    }

    if (battle.loserId === myId) {
        return { text: "패", class: "lose" };
    }

    return { text: "", class: "neutral" };
}

function formatBattleDate(battle) {
    if (!battle?.createdAt) return "";

    const d = new Date(battle.createdAt);
    if (isNaN(d.getTime())) return "";

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");

    return `${y}.${m}.${day} ${hh}:${mm}`;
}

/* =========================================================
   렌더 함수
========================================================= */
function renderBattle(battle) {
    const container = document.getElementById("battleLogContainer");

    if (!container) return;

    const enemyImg = resolveCharImage(battle.enemyImage);
    const logs = battle.logs || [];

    // 🔥 청크별 경계 개행 정리
    const processed = logs.map((log, index) => {
        let text = log.text || "";

        const isFirst = index === 0;
        const isLast = index === logs.length - 1;

        if (!isFirst) {
            text = text.replace(/^\r?\n+/, "");
        }

        if (!isLast) {
            text = text.replace(/\r?\n+$/, "");
        }

        return text;
    });

    // 🔥 하나의 문자열로 합침 (문단 개행은 유지됨)
    const fullText = processed.join("");

    // 🔥 파싱
    const parsed = parseStoryText(fullText);

    const result = formatBattleResult(battle);
    const dateStr = formatBattleDate(battle);

    container.innerHTML = `
    <div class="battle-log-header">
        <img src="${enemyImg}" />
        <div class="battle-log-header-text">
            <h2>${battle.enemyName || "전투"} 전</h2>
            <div class="battle-log-meta">
                <span class="battle-result ${result.class}">
                    ${result.text}
                </span>
                <span class="battle-date">
                    ${dateStr}
                </span>
            </div>
        </div>
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
    if (battle.status === "process" || battle.status === "streaming") {
        connectBattleStream(battleId);
    }
}
