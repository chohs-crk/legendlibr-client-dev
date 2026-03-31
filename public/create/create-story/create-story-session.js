/* ================================
   SESSION / STORAGE
================================ */
import { INTRO_ANIMATED_KEY } from "./create-story-constants.js";

if (!sessionStorage.getItem("story_log")) {
    sessionStorage.setItem("story_log", JSON.stringify([]));
}

export function getStoryLog() {
    return JSON.parse(sessionStorage.getItem("story_log") || "[]");
}

export function setStoryLog(log) {
    sessionStorage.setItem("story_log", JSON.stringify(log));
}

export function choicesKey(flow) {
    return `choices_backup_${flow}`;
}

export function backupChoices(flow, choices) {
    sessionStorage.setItem(choicesKey(flow), JSON.stringify(choices || []));
}

export function readBackupChoices(flow) {
    return JSON.parse(sessionStorage.getItem(choicesKey(flow)) || "[]");
}

export function clearCreationFlowCache() {
    sessionStorage.removeItem("story_log");
    sessionStorage.removeItem("choices_backup_story1");
    sessionStorage.removeItem("choices_backup_story3");
    sessionStorage.removeItem("currentSceneKey");
    sessionStorage.removeItem(INTRO_ANIMATED_KEY);
}

export function moveToCharacter(id) {
    if (!id) return;

    clearCreationFlowCache();
    sessionStorage.setItem("viewCharId", id);
    sessionStorage.setItem("homeCalled", "false");
    location.href = `/character/${id}`;
}
