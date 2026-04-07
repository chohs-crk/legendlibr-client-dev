function setConfirmBackgroundState(isOpen) {
    const app = document.querySelector(".app");
    if (app) app.classList.toggle("confirm-open", !!isOpen);
}

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

       document.getElementById("confirmOverlay").style.display = "flex";
        setConfirmBackgroundState(true);
    }

    export function closeConfirm() {
        document.getElementById("confirmOverlay").style.display = "none";
        setConfirmBackgroundState(false);
    }
//🟢