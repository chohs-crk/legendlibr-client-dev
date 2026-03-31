/* ================================
   FLOW CONTROL
================================ */
import {
    fetchSceneState,
    requestFinalComplete,
    requestFinalPreview,
    requestSceneStream,
    submitChoice
} from "./create-story-api.js";
import { FINAL_MOVE_BUTTON_TEXT, INTRO_ANIMATED_KEY } from "./create-story-constants.js";
import { choiceBox, infoArea, storyBox, scrollToBottom, shouldFollowScroll, updateFollowScroll } from "./create-story-dom.js";
import { backupChoices, getStoryLog, moveToCharacter, readBackupChoices, setStoryLog } from "./create-story-session.js";
import { resetSceneRuntime, runtimeState } from "./create-story-state.js";
import {
    appendToken,
    buildSelectedChoiceNode,
    createParseState,
    ensureCharIntro,
    escapeHtml,
    normalizeChoices,
    parseStaticRichText,
    parseTextToTokens,
    renderCharIntroInstant,
    renderCharName,
    renderStoryFromLog,
    resetParseState,
    sleep
} from "./create-story-text.js";

function getFinalMoveButton() {
    return choiceBox.querySelector("[data-final-move-btn='1']");
}

function setFinalMoveButtonLoading(message = "준비 중…") {
    const btn = getFinalMoveButton();
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = `<span class="choice-btn__text">${escapeHtml(message)}</span>`;
}

function renderFinalMoveButton() {
    choiceBox.innerHTML = "";

    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.type = "button";
    btn.setAttribute("data-final-move-btn", "1");
    btn.innerHTML = `<span class="choice-btn__text">${FINAL_MOVE_BUTTON_TEXT}</span>`;
    btn.addEventListener("click", onClickFinalMoveButton);

    choiceBox.appendChild(btn);

    if (shouldFollowScroll()) {
        scrollToBottom();
    }
}

async function waitForPrinterIdle() {
    while (runtimeState.isPrinting || runtimeState.outputQueue.length > 0) {
        await sleep(40);
    }
}

function maybeRevealChoices() {
    if (runtimeState.choicesRendered) return;
    if (runtimeState.isRevealingChoices) return;
    if (!runtimeState.completed) return;
    if (runtimeState.isPrinting) return;
    if (runtimeState.outputQueue.length !== 0) return;
    if (!runtimeState.collectedChoices || runtimeState.collectedChoices.length === 0) return;

    renderChoicesStaggered();
}

function startPrinter() {
    if (runtimeState.isPrinting) return;

    updateFollowScroll();
    runtimeState.isPrinting = true;

    const tick = async () => {
        if (runtimeState.outputQueue.length === 0) {
            runtimeState.isPrinting = false;
            maybeRevealChoices();
            return;
        }

        let sentence = runtimeState.outputQueue.shift();
        const currentText = storyBox.textContent || "";
        const endsWithWhitespace = currentText.length === 0 ? true : /\s$/.test(currentText);

        if (
            currentText.length > 0 &&
            !endsWithWhitespace &&
            sentence.length > 0 &&
            !/\s/.test(sentence[0].char)
        ) {
            sentence.unshift({ char: " ", em: false });
        }

        for (const token of sentence) {
            appendToken(storyBox, token);

            if (shouldFollowScroll()) {
                scrollToBottom();
            }

            await sleep(10);
        }

        setTimeout(tick, 50);
    };

    tick();
}

async function renderChoicesStaggered() {
    if (runtimeState.choicesRendered) return;
    if (runtimeState.isRevealingChoices) return;

    runtimeState.choicesRendered = true;
    runtimeState.isRevealingChoices = true;

    choiceBox.innerHTML = "";

    for (let idx = 0; idx < runtimeState.collectedChoices.length; idx++) {
        const text = runtimeState.collectedChoices[idx];

        const btn = document.createElement("button");
        btn.className = "choice-btn is-hidden";
        btn.type = "button";
        btn.innerHTML = `<span class="choice-btn__text">${parseStaticRichText(text)}</span>`;
        btn.onclick = () => selectChoice(idx);

        choiceBox.appendChild(btn);

        requestAnimationFrame(() => {
            btn.classList.remove("is-hidden");
        });

        if (shouldFollowScroll()) {
            scrollToBottom();
        }

        await sleep(300);
    }

    runtimeState.isRevealingChoices = false;
}

async function animateFinalStory(endingText) {
    const cleanText = String(endingText || "");
    if (!cleanText) return;

    const log = getStoryLog();
    const last = log[log.length - 1];

    if (!last || last.scene !== "final") {
        log.push({ scene: "final", story: "", choice: null });
        setStoryLog(log);
    }

    renderStoryFromLog();

    const localState = createParseState();
    const tokens = parseTextToTokens(cleanText, localState);

    runtimeState.completed = false;
    runtimeState.collectedChoices = [];
    runtimeState.outputQueue = [];
    runtimeState.isPrinting = false;
    runtimeState.choicesRendered = false;
    runtimeState.isRevealingChoices = false;

    if (tokens.length > 0) {
        runtimeState.outputQueue.push(tokens);
        startPrinter();
        await waitForPrinterIdle();
    }

    const newLog = getStoryLog();
    const newLast = newLog[newLog.length - 1];
    if (newLast && newLast.scene === "final") {
        newLast.story = cleanText;
        setStoryLog(newLog);
    }

    runtimeState.completed = true;
}

function ensureFinalCompleteStarted() {
    if (runtimeState.finalCompleteResult?.id) {
        return Promise.resolve(runtimeState.finalCompleteResult);
    }

    if (!runtimeState.finalCompletePromise) {
        runtimeState.finalCompletePromise = requestFinalComplete()
            .then(data => {
                runtimeState.finalCompleteResult = data;
                return data;
            })
            .catch(error => {
                runtimeState.finalCompletePromise = null;
                throw error;
            });
    }

    return runtimeState.finalCompletePromise;
}

async function beginFinalFlow() {
    if (runtimeState.finalPreviewStarted) return;
    runtimeState.finalPreviewStarted = true;
    runtimeState.currentSceneKey = "final";

    try {
        renderStoryFromLog();
        choiceBox.innerHTML = "";
        infoArea.textContent = "결말을 정리하고 있습니다…";

        const preview = await requestFinalPreview();
        ensureFinalCompleteStarted();

        const log = getStoryLog();
        const last = log[log.length - 1];
        const hasRenderedFinal = last?.scene === "final" && String(last?.story || "").trim().length > 0;

        if (!hasRenderedFinal) {
            await animateFinalStory(preview.ending || "");
        } else {
            renderStoryFromLog();
        }

        renderFinalMoveButton();

        if (runtimeState.finalCompleteResult?.id) {
            infoArea.textContent = "캐릭터 정보가 준비되었습니다.";
            return;
        }

        infoArea.textContent = "캐릭터의 힘을 정리하고 있습니다…";
        runtimeState.finalCompletePromise
            ?.then(() => {
                if (!runtimeState.finalMoveRequested) {
                    infoArea.textContent = "캐릭터 정보가 준비되었습니다.";
                }
            })
            .catch(error => {
                if (!runtimeState.finalMoveRequested) {
                    infoArea.textContent = error?.message || "캐릭터 정보를 정리하는 중 문제가 발생했습니다.";
                }
            });
    } catch (error) {
        runtimeState.finalPreviewStarted = false;
        infoArea.textContent = "";
        alert(error?.message || "캐릭터 생성 중 문제가 발생했습니다.");
        location.href = "/";
    }
}

async function onClickFinalMoveButton() {
    if (runtimeState.finalMoveRequested) return;
    runtimeState.finalMoveRequested = true;

    try {
        if (runtimeState.finalCompleteResult?.id) {
            moveToCharacter(runtimeState.finalCompleteResult.id);
            return;
        }

        infoArea.textContent = "캐릭터 정보를 준비하고 있습니다…";
        setFinalMoveButtonLoading("준비 중…");

        const result = await ensureFinalCompleteStarted();
        moveToCharacter(result.id);
    } catch (error) {
        runtimeState.finalMoveRequested = false;
        infoArea.textContent = error?.message || "캐릭터 정보를 준비하는 중 문제가 발생했습니다.";

        const btn = getFinalMoveButton();
        if (!btn) return;

        btn.disabled = false;
        btn.innerHTML = `<span class="choice-btn__text">${FINAL_MOVE_BUTTON_TEXT}</span>`;
    }
}

function showRetry(remain, flow) {
    renderStoryFromLog();
    choiceBox.innerHTML = "";

    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.type = "button";
    btn.disabled = true;

    const safeRemain = Math.max(1000, remain || 0);
    let left = Math.ceil(safeRemain / 1000);

    btn.innerHTML = `<span class="choice-btn__text">재시도까지 ${left}s</span>`;
    choiceBox.appendChild(btn);

    const timer = setInterval(() => {
        left -= 1;

        if (left <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.innerHTML = '<span class="choice-btn__text">다시 시도</span>';
            btn.onclick = () => {
                choiceBox.innerHTML = "";
                infoArea.textContent = "AI 재시도 중…";
                streamScene(flow, true);
            };
            return;
        }

        btn.innerHTML = `<span class="choice-btn__text">재시도까지 ${left}s</span>`;
    }, 1000);
}

async function streamScene(flow, force = false) {
    runtimeState.currentSceneKey = flow;
    resetSceneRuntime();
    resetParseState(runtimeState.streamParseState);

    choiceBox.innerHTML = "";
    infoArea.textContent = "AI 작성 중…";

    updateFollowScroll();

    const res = await requestSceneStream(flow, force);
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        const data = await res.json();

        if (data.status === "waiting") {
            showRetry(data.remain || 0, flow);
            return;
        }

        if (data.status === "done") {
            const log = getStoryLog();
            const last = log[log.length - 1];
            if (last && data.story) {
                last.story = data.story;
                setStoryLog(log);
            }

            runtimeState.collectedChoices = normalizeChoices(data.choices);
            backupChoices(flow, runtimeState.collectedChoices);

            renderStoryFromLog();
            renderChoicesStaggered();
            infoArea.textContent = "";
            return;
        }
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;

            if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
                continue;
            }

            if (!line.startsWith("data:")) {
                continue;
            }

            const payload = line.slice(5);
            if (!payload) continue;

            if (currentEvent === "error") {
                alert("스토리 생성 중 오류가 발생했습니다.");
                sessionStorage.removeItem("story_log");
                location.href = "/";
                return;
            }

            if (currentEvent === "choices") {
                try {
                    const data = JSON.parse(payload);
                    runtimeState.collectedChoices = normalizeChoices(data.choices);
                    backupChoices(flow, runtimeState.collectedChoices);

                    const log = getStoryLog();
                    const last = log[log.length - 1];
                    if (last) {
                        last.story += runtimeState.logicalStoryBuffer;
                        setStoryLog(log);
                    }

                    runtimeState.logicalStoryBuffer = "";
                    runtimeState.tempStoryBuffer = "";

                    maybeRevealChoices();
                } catch (_) {
                    // ignore malformed choices payload
                }
                continue;
            }

            if (currentEvent === "done") {
                runtimeState.completed = true;
                maybeRevealChoices();
                continue;
            }

            const clean = payload.replace(/<[^>]*>/g, "");
            if (!clean) {
                continue;
            }

            runtimeState.logicalStoryBuffer += clean;
            runtimeState.tempStoryBuffer += clean;

            const tokens = parseTextToTokens(clean, runtimeState.streamParseState);
            if (tokens.length > 0) {
                runtimeState.outputQueue.push(tokens);
                startPrinter();
            }
        }
    }

    if (runtimeState.completed) {
        infoArea.textContent = "";
    }
}

async function selectChoice(index) {
    const log = getStoryLog();
    const last = log[log.length - 1];

    if (last && runtimeState.collectedChoices[index]) {
        last.choice = runtimeState.collectedChoices[index];
        setStoryLog(log);
    }

    choiceBox.querySelectorAll("button").forEach(btn => {
        btn.disabled = true;
    });

    await submitChoice(runtimeState.currentSceneKey, index);
    await startCreateStoryFlow();
}

export async function startCreateStoryFlow() {
    const state = await fetchSceneState();

    if (!state.ok) {
        alert("캐릭터 생성이 종료되었습니다.\n새로 생성할 수 있습니다.");
        location.href = "/";
        return;
    }

    if (state.intro) {
        sessionStorage.setItem("aiIntro", state.intro);
    }

    renderCharName();

    const flow = state.flow;
    if (!flow) {
        renderCharIntroInstant();
        return;
    }

    if (flow === "final") {
        await ensureCharIntro(flow, false);
        renderStoryFromLog();
        await beginFinalFlow();
        return;
    }

    const { called, resed, remain } = state;
    const log = getStoryLog();
    const last = log[log.length - 1];
    const isNewScene = !last || last.scene !== flow;

    if (!called && !resed) {
        renderStoryFromLog();

        if (isNewScene) {
            log.push({ scene: flow, story: "", choice: null });
            setStoryLog(log);
        }

        if (flow === "story1" && isNewScene) {
            sessionStorage.removeItem(INTRO_ANIMATED_KEY);
        }

        await ensureCharIntro(flow, flow === "story1" && isNewScene);
        await streamScene(flow);
        return;
    }

    if (called && resed) {
        runtimeState.currentSceneKey = flow;
        await ensureCharIntro(flow, false);
        renderStoryFromLog();

        runtimeState.collectedChoices = normalizeChoices(readBackupChoices(flow));
        runtimeState.choicesRendered = false;
        runtimeState.isRevealingChoices = false;
        await renderChoicesStaggered();
        return;
    }

    if (called && !resed) {
        await ensureCharIntro(flow, false);
        showRetry(remain, flow);
    }
}
