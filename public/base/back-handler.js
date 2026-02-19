// /base/back-handler.js

export function handleBackAction() {

    const dialog = document.getElementById("detailDialog");
    if (dialog?.hasAttribute("open")) {
        window.__closeCharacterDetailDialog?.();
        return;
    }

    const wrap = document.getElementById("wrapOverlay");
    if (wrap && getComputedStyle(wrap).display !== "none") {
        wrap.style.display = "none";
        return;
    }

    // ✅ 앱 내부 back만 사용 (브라우저 밖 이동 금지)
    window.__appBack?.();
}
