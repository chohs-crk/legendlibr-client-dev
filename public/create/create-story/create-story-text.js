/* ================================
   TEXT / RENDER UTIL
================================ */
import {
    charIntro,
    charName,
    scrollRoot,
    storyBox,
    scrollToBottom,
    shouldFollowScroll
} from "./create-story-dom.js";
import { INTRO_ANIMATED_KEY } from "./create-story-constants.js";
import { getStoryLog, setStoryLog } from "./create-story-session.js";

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeChoices(list) {
    return (list || [])
        .map(choice => {
            if (typeof choice === "string") return choice;
            if (choice && typeof choice === "object" && "text" in choice) {
                return String(choice.text ?? "");
            }
            return String(choice ?? "");
        })
        .map(text => text.trim())
        .filter(Boolean);
}

export function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function createParseState() {
    return {
        emPendingStar: false,
        emActive: false,
        talkActive: false
    };
}

export function resetParseState(state) {
    state.emPendingStar = false;
    state.emActive = false;
    state.talkActive = false;
}

export function parseTextToTokens(text, state = createParseState()) {
    const result = [];

    for (const ch of text || "") {
        if (ch === "§") {
            state.talkActive = !state.talkActive;
            result.push({ char: '"', em: false });
            continue;
        }

        if (ch === "*") {
            if (!state.emPendingStar) {
                state.emPendingStar = true;
            } else {
                state.emPendingStar = false;
                state.emActive = !state.emActive;
            }
            continue;
        }

        if (ch === "$") {
            if (state.emPendingStar) {
                state.emPendingStar = false;
            }
            state.emActive = !state.emActive;
            continue;
        }

        if (state.emPendingStar) {
            state.emPendingStar = false;
        }

        result.push({
            char: ch,
            em: state.emActive
        });
    }

    return result;
}

export function tokensToHTML(tokens) {
    return (tokens || [])
        .map(token => {
            const safeChar = escapeHtml(token.char);
            return token.em
                ? `<span class="story-em">${safeChar}</span>`
                : safeChar;
        })
        .join("");
}

export function parseStaticRichText(text) {
    const localState = createParseState();
    return tokensToHTML(parseTextToTokens(text || "", localState));
}

export function appendToken(target, token) {
    if (!target || !token) return;

    if (token.em) {
        const span = document.createElement("span");
        span.className = "story-em";
        span.textContent = token.char;
        target.appendChild(span);
        return;
    }

    target.append(token.char);
}

export function buildSelectedChoiceNode(text) {
    const wrap = document.createElement("div");
    wrap.className = "selected-choice";
    wrap.innerHTML = `<div class="selected-choice__text">${parseStaticRichText(text)}</div>`;
    return wrap;
}

export async function typeTextIntoElement(target, text, speed = 14) {
    if (!target) return;

    target.innerHTML = "";
    const localState = createParseState();
    const tokens = parseTextToTokens(text || "", localState);

    for (const token of tokens) {
        appendToken(target, token);

        if (shouldFollowScroll()) {
            scrollToBottom();
        }

        await sleep(speed);
    }
}

export function renderCharName() {
    if (!charName) return;
    charName.textContent = sessionStorage.getItem("displayNameRaw") || "";
}

export function renderCharIntroInstant() {
    if (!charIntro) return;
    const intro = sessionStorage.getItem("aiIntro") || "";
    charIntro.innerHTML = intro ? parseStaticRichText(intro) : "";
}

export async function renderCharIntroAnimated() {
    const intro = sessionStorage.getItem("aiIntro") || "";

    if (!intro) {
        if (charIntro) charIntro.innerHTML = "";
        sessionStorage.setItem(INTRO_ANIMATED_KEY, "1");
        return;
    }

    await typeTextIntoElement(charIntro, intro, 16);
    sessionStorage.setItem(INTRO_ANIMATED_KEY, "1");
}

export async function ensureCharIntro(flow, animate = false) {
    if (flow === "story1" && animate && sessionStorage.getItem(INTRO_ANIMATED_KEY) !== "1") {
        await renderCharIntroAnimated();
        return;
    }

    renderCharIntroInstant();
}

export function renderStoryFromLog() {
    const prevScrollTop = scrollRoot ? scrollRoot.scrollTop : 0;
    const wasNearBottom = scrollRoot
        ? (scrollRoot.scrollHeight - (scrollRoot.scrollTop + scrollRoot.clientHeight)) <= 30
        : true;

    storyBox.innerHTML = "";
    const log = getStoryLog();
    const renderState = createParseState();

    for (const entry of log) {
        if (entry.story) {
            const tokens = parseTextToTokens(entry.story, renderState);

            for (const token of tokens) {
                appendToken(storyBox, token);
            }

            storyBox.append("\n\n");
        }

        if (entry.choice) {
            storyBox.appendChild(buildSelectedChoiceNode(entry.choice));
            storyBox.append("\n\n");
        }
    }

    if (!scrollRoot) return;

    if (wasNearBottom) {
        scrollToBottom();
        return;
    }

    const maxTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
    scrollRoot.scrollTop = Math.min(prevScrollTop, maxTop);
}
