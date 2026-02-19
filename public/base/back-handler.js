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

    if (history.length > 1) {
        history.back();
    }
}
