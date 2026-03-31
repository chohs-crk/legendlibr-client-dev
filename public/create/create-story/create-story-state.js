/* ================================
   RUNTIME STATE
================================ */
import { createParseState } from "./create-story-text.js";

export const runtimeState = {
    completed: false,
    currentSceneKey: null,
    collectedChoices: [],
    isPrinting: false,
    outputQueue: [],
    choicesRendered: false,
    isRevealingChoices: false,
    finalPreviewStarted: false,
    finalCompletePromise: null,
    finalCompleteResult: null,
    finalMoveRequested: false,
    logicalStoryBuffer: "",
    tempStoryBuffer: "",
    streamParseState: createParseState()
};

export function resetSceneRuntime() {
    runtimeState.completed = false;
    runtimeState.collectedChoices = [];
    runtimeState.outputQueue = [];
    runtimeState.isPrinting = false;
    runtimeState.choicesRendered = false;
    runtimeState.isRevealingChoices = false;
    runtimeState.logicalStoryBuffer = "";
    runtimeState.tempStoryBuffer = "";
}
