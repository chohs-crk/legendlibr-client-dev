const SHOP_TOAST_DURATION = 1800;
let toastTimer = null;

function showShopToast(message) {
    const toast = document.getElementById("shopToast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("is-visible");

    if (toastTimer) {
        clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
    }, SHOP_TOAST_DURATION);
}

function bindShopButtons() {
    document.querySelectorAll("#page-shop .shop-buy-btn").forEach((button) => {
        if (button.dataset.bound === "1") return;

        button.dataset.bound = "1";
        button.addEventListener("click", () => {
            showShopToast("아직 준비 중");
        });
    });
}

export function initShopPage() {
    bindShopButtons();
}
