// /base/common/overscroll-bounce.js
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
        if (area.dataset.boundBounce === "1") return;
        area.dataset.boundBounce = "1";

        let startY = 0;
        let isDragging = false;
        let isRefreshing = false;
        let pullDistance = 0;

        const appearStart = maxPull * 0.3;
        const refreshStart = maxPull * 0.7;

        /* -----------------------------
           PTR Indicator (보라 화살표만)
        ----------------------------- */
        const ptr = document.createElement("div");
        ptr.style.cssText = `
            position:absolute;
            top:0; left:0; right:0;
            height:0px;
            display:flex;
            align-items:center;
            justify-content:center;
            pointer-events:none;
            z-index:5;
        `;

        const icon = document.createElement("div");
        icon.textContent = "↻";
        icon.style.cssText = `
            font-size:26px;
            font-weight:700;
            color:#a060ff;
            opacity:0;
            transform: rotate(0deg);
            transition: opacity 0.15s;
            transform-origin:center;
        `;

        ptr.appendChild(icon);
        area.parentElement.insertBefore(ptr, area);

        const resetPTR = () => {
            ptr.style.height = "0px";
            icon.style.opacity = "0";
            icon.style.transform = "rotate(0deg)";
        };

        area.style.transform = "translateY(0)";
        area.style.transition = "0s";

        /* -----------------------------
           TOUCH START
        ----------------------------- */
        area.addEventListener("touchstart", e => {
            if (isRefreshing) return;
            startY = e.touches[0].clientY;
            isDragging = true;
            pullDistance = 0;
            area.style.transition = "0s";
        }, { passive: true });

        /* -----------------------------
           TOUCH MOVE
        ----------------------------- */
        area.addEventListener("touchmove", e => {
            if (!isDragging || isRefreshing) return;

            const currentY = e.touches[0].clientY;
            const diff = currentY - startY;

            const atTop = area.scrollTop <= 0;
            const atBottom =
                area.scrollTop + area.clientHeight >= area.scrollHeight - 1;

            /* ---------- TOP PULL (PTR) ---------- */
            if (diff > 0 && atTop) {
                e.preventDefault();

                pullDistance = Math.min(maxPull, diff * resistance);

                if (pullDistance < appearStart) {
                    resetPTR();
                    area.style.transform = "translateY(0)";
                    return;
                }

                const activePull =
                    Math.min(refreshStart, pullDistance) - appearStart;

                area.style.transform = `translateY(${activePull}px)`;

                // 🔽 화살표는 3배 빠르게 내려오게
                ptr.style.height = `${activePull * 3}px`;

                icon.style.opacity = "1";

                // 🔄 총 1.5바퀴 (540deg)
                const ratio =
                    Math.min(1, (pullDistance - appearStart) / (refreshStart - appearStart));

                const rotateDeg = ratio * 540;
                icon.style.transform = `rotate(${rotateDeg}deg)`;

                return;
            }

            /* ---------- BOTTOM BOUNCE (refresh X) ---------- */
            if (diff < 0 && atBottom) {
                e.preventDefault();

                const offset = diff * resistance; // diff는 음수 → 위로 살짝 당김
                area.style.transform = `translateY(${offset}px)`;

                // 아래쪽에서는 PTR 숨김 (안전)
                resetPTR();

                return;
            }

        }, { passive: false });


        /* -----------------------------
           TOUCH END
        ----------------------------- */
        area.addEventListener("touchend", async () => {
            if (!isDragging || isRefreshing) return;
            isDragging = false;

            // 새로고침 미발동
            if (pullDistance < refreshStart) {
                area.style.transition = "transform 0.25s ease-out";
                area.style.transform = "translateY(0)";
                resetPTR();
                return;
            }

            /* -------- 새로고침 연출 -------- */
            isRefreshing = true;

            const holdY = refreshStart - appearStart;
            area.style.transition = "transform 0.2s ease-out";
            area.style.transform = `translateY(${holdY}px)`;

            // 0.5초간 초당 3바퀴 회전
            const spinDuration = 500; // ms
            const spinDeg = 1080 * (spinDuration / 1000); // 3 rps

            icon.style.transition = "transform 0.5s linear";
            icon.style.transform = `rotate(${540 + spinDeg}deg)`;

            setTimeout(async () => {
                try {
                    await onRefresh();
                } finally {
                    isRefreshing = false;
                    resetPTR();
                    area.style.transition = "transform 0.25s ease-out";
                    area.style.transform = "translateY(0)";
                }
            }, spinDuration);
        });
    });
}
