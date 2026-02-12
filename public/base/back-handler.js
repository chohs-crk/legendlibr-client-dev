// /base/back-handler.js

export function handleBackAction() {
    const dialog = document.getElementById("detailDialog");
   

    // 1) dialog 열려 있으면 닫기
    if (dialog?.hasAttribute("open")) {
        if (typeof window.__closeCharacterDetailDialog === "function") {
            window.__closeCharacterDetailDialog();
        } else {
            dialog.removeAttribute("open");
        }
        return;
    }

    // 2) wrap overlay 열려 있으면 닫기
    const wrap = document.getElementById("wrapOverlay");
    if (wrap && getComputedStyle(wrap).display !== "none") {
        wrap.style.display = "none";
        return;
    }


    // 3) 그 외에는 SPA 뒤로가기
    history.back();
}
