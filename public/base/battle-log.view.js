// /base/battle-log.view.js
import { resolveCharImage } from "/base/common/image-util.js";

// ⚠️ import 불가하므로 parseStoryText를 이 안에 직접 포함
function parseStoryText(raw) {
    if (!raw) return "";
    let html = String(raw);

    html = html.replace(/story-(em|talk|skill)\"?>/gi, "");
    html = html.replace(/<span[^>]*>/gi, "");
    html = html.replace(/<\/span>/gi, "");
    html = html.replace(/&lt;\/?span[^&]*&gt;/gi, "");

    html = html.replace(/\*\*(.+?)\*\*/g, (_, txt) => `<span class="story-em">${txt}</span>`);

    // 대사 강조: §대사§ 형식
    html = html.replace(/§([^§]+?)§/g, (_, txt) => `"${'<span class="story-talk">' + txt + "</span>"}"`);

    html = html.replace(/『(.+?)』/g, (_, txt) => `『<span class="story-skill">${txt}</span>』`);

    html = html.replace(/\r\n/g, "\n");
    html = html.replace(/\n{2,}/g, "<br><br>");
    html = html.replace(/\n/g, " ");

    return html.trim();
}

// -------------------------------------------------------
// 🧩 전투 로그 페이지 초기화
// -------------------------------------------------------
export async function initBattleLogPage(battle) {
    const container = document.getElementById("battleLogContainer");

    if (!battle) {
        container.innerHTML = "<div>전투 기록이 없습니다.</div>";
        return;
    }

    const enemyImg = resolveCharImage(battle.enemyImage);

    const sections = [];

    if (battle.prologue) {
        sections.push(`<h3>전투 개시</h3>${parseStoryText(battle.prologue)}`);
    }

    const logs = battle.logs || [];
    logs.forEach(log => {
        const skillA = log.skillAName || "행동";
        const narration = log.narration || "";
        sections.push(`
            <div class="battle-section">
                <div class="battle-skill">${skillA}</div>
                <div class="battle-text">${parseStoryText(narration)}</div>
            </div>
        `);
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
