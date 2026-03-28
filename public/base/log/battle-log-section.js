import { parseStoryText } from "/base/common/story-parser.js";
import { formatStoryWithDialogue } from "/base/common/story-format.js";

function isBattleRunning(battle) {
    return battle?.status !== "done" && battle?.status !== "error";
}

function createInlineSpinner() {
    const spinner = document.createElement("span");
    spinner.className = "inline-tail-spinner";
    spinner.setAttribute("aria-hidden", "true");
    spinner.innerHTML = '<span class="inline-tail-spinner__ring"></span>';
    return spinner;
}

function appendSpinnerToLastText(logBody) {
    if (!logBody) return;

    const spinner = createInlineSpinner();
    let target = logBody.lastElementChild;

    while (target && target.tagName === "BR") {
        target = target.previousElementSibling;
    }

    if (target && !target.classList.contains("battle-empty")) {
        target.appendChild(document.createTextNode(" "));
        target.appendChild(spinner);
        return;
    }

    if (target) {
        target.appendChild(document.createTextNode(" "));
        target.appendChild(spinner);
        return;
    }

    logBody.appendChild(spinner);
}

export function buildBattleLogSection(battle) {
    const logs = Array.isArray(battle?.logs) ? battle.logs : [];

    let rawText = logs.map((item) => item?.text || "").join("\n");
    if (!logs.length && isBattleRunning(battle)) {
        rawText = "전투 진행 중";
    }

    const formattedRaw = formatStoryWithDialogue(rawText);
    const parsedText = parseStoryText(formattedRaw);

    return `
        <section class="battle-log-section">
            <div class="battle-log-body text-flow js-battle-log-body">
                ${parsedText || "<div class='battle-empty'>로그 없음</div>"}
            </div>
        </section>
    `;
}

export function attachBattleLogSection(container, battle) {
    if (!container || !isBattleRunning(battle)) return;

    const logBody = container.querySelector(".js-battle-log-body");
    if (!logBody) return;

    appendSpinnerToLastText(logBody);
}
