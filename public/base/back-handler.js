export function handleBackAction() {

    const dialog = document.getElementById("detailDialog");
    if (dialog?.hasAttribute("open")) {
        dialog.removeAttribute("open");
        return;
    }

    const wrap = document.getElementById("wrapOverlay");
    if (wrap && getComputedStyle(wrap).display !== "none") {
        wrap.style.display = "none";
        return;
    }

    const stack = window.__appStack;

    if (!stack || stack.length <= 1) return;

    // 현재 제거
    stack.pop();

    const prev = stack[stack.length - 1];

    window.showPage(prev, { fromPop: true });
}
