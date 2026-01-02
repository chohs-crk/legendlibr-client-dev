// /base/common/ui-wrap.js

export function openWrap(html) {
    document.getElementById("wrapBody").innerHTML = html;
    document.getElementById("wrapOverlay").style.display = "block";
    document.body.classList.add("dialog-open");
}

export function closeWrap() {
    document.getElementById("wrapOverlay").style.display = "none";
    document.body.classList.remove("dialog-open");
}

/* ✅ 여기 추가 */
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("wrapClose")
        ?.addEventListener("click", closeWrap);
});
