export function createBackHandler({
    dialog,
    onNormalBack,
    onBattleBack
} = {}) {
    return () => {
        if (dialog?.hasAttribute?.("open")) {
            dialog.removeAttribute("open");
            return;
        }

        const params = new URLSearchParams(location.search);
        if (params.get("from") === "battle" && onBattleBack) {
            onBattleBack();
            return;
        }

        onNormalBack ? onNormalBack() : history.back();
    };
}
