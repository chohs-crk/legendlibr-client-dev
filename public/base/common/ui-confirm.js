export function openConfirm(text, { onConfirm, onCancel } = {}) {
    document.getElementById("confirmText").textContent = text;

    const actions = document.getElementById("confirmActions");
    actions.innerHTML = "";

    if (onCancel) {
        const cancel = document.createElement("button");
        cancel.textContent = "취소";
        cancel.onclick = () => {
            closeConfirm();
            onCancel();
        };
        actions.appendChild(cancel);
    }

    const ok = document.createElement("button");
    ok.textContent = "확인";
    ok.onclick = () => {
        closeConfirm();
        onConfirm?.();
    };
    actions.appendChild(ok);

    document.getElementById("confirmOverlay").style.display = "block";
    document.body.classList.add("dialog-open");
}

export function closeConfirm() {
    document.getElementById("confirmOverlay").style.display = "none";
    document.body.classList.remove("dialog-open");
}
//🟢