const STYLE_ID = "timed-info-tip-style";
let activeTipEl = null;
let activeTimer = null;
let activeCleanup = null;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .timed-info-tip {
            position: fixed;
            z-index: 9999;
            max-width: min(280px, calc(100vw - 24px));
            padding: 10px 12px;
            border-radius: 12px;
            border: 1px solid rgba(183, 142, 255, 0.34);
            background: rgba(20, 13, 36, 0.96);
            color: #f6edff;
            font-size: 12px;
            line-height: 1.55;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
            opacity: 0;
            transform: translateY(4px);
            transition: opacity 0.16s ease, transform 0.16s ease;
            pointer-events: none;
            backdrop-filter: blur(8px);
        }

        .timed-info-tip.is-visible {
            opacity: 1;
            transform: translateY(0);
        }
    `;
    document.head.appendChild(style);
}

function clearActiveTip() {
    if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
    }
    if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
    }
    if (activeTipEl) {
        activeTipEl.remove();
        activeTipEl = null;
    }
}

function positionTip(target, tipEl, offset = 10) {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const tipWidth = tipEl.offsetWidth;
    const tipHeight = tipEl.offsetHeight;

    let left = rect.left + (rect.width / 2) - (tipWidth / 2);
    left = Math.max(12, Math.min(left, viewportWidth - tipWidth - 12));

    const showAbove = rect.top > tipHeight + offset + 12;
    let top = showAbove
        ? rect.top - tipHeight - offset
        : rect.bottom + offset;

    top = Math.max(12, Math.min(top, viewportHeight - tipHeight - 12));

    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
}

export function showTimedInfoTip(target, text, {
    duration = 2000,
    offset = 10
} = {}) {
    if (!target || !text) return;

    ensureStyle();
    clearActiveTip();

    const tipEl = document.createElement("div");
    tipEl.className = "timed-info-tip";
    tipEl.setAttribute("role", "status");
    tipEl.setAttribute("aria-live", "polite");
    tipEl.textContent = text;
    document.body.appendChild(tipEl);

    positionTip(target, tipEl, offset);

    const reposition = () => positionTip(target, tipEl, offset);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    activeCleanup = () => {
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
    };

    requestAnimationFrame(() => {
        tipEl.classList.add("is-visible");
    });

    activeTipEl = tipEl;
    activeTimer = window.setTimeout(() => {
        clearActiveTip();
    }, Math.max(400, Number(duration) || 2000));
}

export function bindTimedInfoTip(target, text, options = {}) {
    if (!target) return () => {};

    const handler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const resolvedText = typeof text === "function" ? text() : text;
        showTimedInfoTip(target, resolvedText, options);
    };

    target.addEventListener("click", handler);

    return () => {
        target.removeEventListener("click", handler);
        clearActiveTip();
    };
}
