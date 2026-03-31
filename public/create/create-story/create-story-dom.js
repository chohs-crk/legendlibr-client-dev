/* ================================
   DOM
================================ */
import { FOLLOW_BOTTOM_PX } from "./create-story-constants.js";

export const storyBox = document.getElementById("storyBox");
export const choiceBox = document.getElementById("choiceBox");
export const infoArea = document.getElementById("infoArea");
export const charIntro = document.getElementById("charIntro");
export const charName = document.getElementById("charName");
export const createScroll = document.getElementById("createScroll");

// 스크롤은 페이지의 단일 스크롤 영역에서 처리
export const scrollRoot = createScroll || storyBox;

let followScroll = true;

export function distanceFromBottom(el) {
    return el.scrollHeight - (el.scrollTop + el.clientHeight);
}

export function shouldFollowScroll() {
    return followScroll;
}

export function setFollowScroll(value) {
    followScroll = Boolean(value);
}

export function updateFollowScroll() {
    if (!scrollRoot) return;
    followScroll = distanceFromBottom(scrollRoot) <= FOLLOW_BOTTOM_PX;
}

export function scrollToBottom() {
    if (!scrollRoot) return;
    scrollRoot.scrollTop = scrollRoot.scrollHeight;
}

if (scrollRoot) {
    scrollRoot.addEventListener("scroll", updateFollowScroll, { passive: true });
    updateFollowScroll();
}
