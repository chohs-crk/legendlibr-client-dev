export function initOverscrollBounce(
    selector = ".scroll-area",
    {
        maxPull = 140,
        resistance = 0.35,
        onRefresh = async () => location.reload()
    } = {}
) {
    const areas = document.querySelectorAll(selector);

    areas.forEach(area => {
        /* =========================
           CLEANUP (SPA 재진입 대비)
        ========================= */
        if (area._overscrollCleanup) {
            area._overscrollCleanup();
        }

        /* =========================
           TARGET CONTENT
           (실제로 움직일 요소)
        ========================= */
        const content = area.firstElementChild;
        if (!content) return;

        content.style.willChange = "transform";

        let startY = 0;
        let isDragging = false;
        let isRefreshing = false;
        let pullDistance = 0;

        const appearStart = maxPull * 0.3;
        const refreshStart = maxPull * 0.7;

        /* =========================
           PTR INDICATOR
        ========================= */
        const ptr = document.createElement("div");
        ptr.style.cssText = `
            position:absolute;
            top:0; left:0; right:0;
            height:0px;
            display:flex;
            align-items:center;
            justify-content:center;
            pointer-events:none;
            z-index:10;
        `;

        const icon = document.createElement("div");
        icon.textContent = "↻";
        icon.style.cssText = `
            font-size:26px;
            font-weight:700;
            color:#a060ff;
            opacity:0;
            transform: rotate(0deg);
            transition: opacity .15s;
            transform-origin:center;
        `;

        ptr.appendChild(icon);
        area.parentElement.style.position ||= "relative";
        area.parentElement.insertBefore(ptr, area);

        const resetVisual = () => {
            ptr.style.height = "0px";
            icon.style.opacity = "0";
            icon.style.transform = "rotate(0deg)";
            content.style.transition = "transform .25s ease-out";
            content.style.transform = "translateY(0)";
        };

        /* =========================
           SCROLL HELPERS
        ========================= */
        const TOP_EPS = 2;
        const BOTTOM_EPS = 2;

        const canScroll = () =>
            area.scrollHeight > area.clientHeight + 1;

        const isAtTop = () =>
            area.scrollTop <= TOP_EPS;

        const isAtBottom = () =>
            canScroll() &&
            area.scrollTop + area.clientHeight >=
            area.scrollHeight - BOTTOM_EPS;

        /* =========================
           TOUCH START
        ========================= */
        const onTouchStart = e => {
            if (isRefreshing) return;
            startY = e.touches[0].clientY;
            isDragging = true;
            pullDistance = 0;
            content.style.transition = "0s";
        };

        /* =========================
           TOUCH MOVE
        ========================= */
        const onTouchMove = e => {
            if (!isDragging || isRefreshing) return;

            const currentY = e.touches[0].clientY;
            const diff = currentY - startY;

            /* ---------- TOP (PTR + BOUNCE) ---------- */
            if (diff > 0 && isAtTop()) {
                e.preventDefault();

                pullDistance = Math.min(maxPull, diff * resistance);

                if (pullDistance < appearStart) {
                    resetVisual();
                    return;
                }

                const activePull =
                    Math.min(refreshStart, pullDistance) - appearStart;

                content.style.transform =
                    `translateY(${activePull}px)`;

                ptr.style.height = `${activePull * 3}px`;
                icon.style.opacity = "1";

                const ratio =
                    Math.min(
                        1,
                        (pullDistance - appearStart) /
                        (refreshStart - appearStart)
                    );

                icon.style.transform =
                    `rotate(${ratio * 540}deg)`;

                return;
            }

            /* ---------- BOTTOM (BOUNCE ONLY) ---------- */
            if (diff < 0 && isAtBottom()) {
                e.preventDefault();
                content.style.transform =
                    `translateY(${diff * resistance}px)`;
                return;
            }
        };

        /* =========================
           TOUCH END
        ========================= */
        const onTouchEnd = async () => {
            if (!isDragging || isRefreshing) return;
            isDragging = false;

            if (pullDistance < refreshStart) {
                resetVisual();
                return;
            }

            /* ---------- REFRESH ---------- */
            isRefreshing = true;

            const holdY = refreshStart - appearStart;
            content.style.transition = "transform .2s ease-out";
            content.style.transform = `translateY(${holdY}px)`;

            icon.style.transition = "transform .5s linear";
            icon.style.transform = "rotate(1620deg)";

            setTimeout(async () => {
                try {
                    await onRefresh();
                } finally {
                    isRefreshing = false;
                    resetVisual();
                }
            }, 500);
        };

        /* =========================
           EVENT BIND
        ========================= */
        area.addEventListener("touchstart", onTouchStart, { passive: true });
        area.addEventListener("touchmove", onTouchMove, { passive: false });
        area.addEventListener("touchend", onTouchEnd);

        /* =========================
           CLEANUP REGISTER
        ========================= */
        area._overscrollCleanup = () => {
            area.removeEventListener("touchstart", onTouchStart);
            area.removeEventListener("touchmove", onTouchMove);
            area.removeEventListener("touchend", onTouchEnd);
            ptr.remove();
            content.style.transform = "";
            content.style.transition = "";
        };
    });
}
