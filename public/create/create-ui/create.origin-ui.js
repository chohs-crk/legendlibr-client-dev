/**
 * create.origin-ui.js
 * - 기원(Origin) 카드 UI 렌더링
 * - 클릭/키보드 이벤트 바인딩
 * - 선택 UI 토글 + 확장 영역 참조 반환
 */

const DEFAULT_ORIGIN_BG = "/images/base/black.png";

/**
 * origin 목록을 DOM에 렌더링합니다.
 * - 기존 코드는 append만 했기 때문에 SPA 재진입 시 중복될 수 있어, 여기서는 기본적으로 비웁니다.
 */
export function renderOriginList(originListEl, ORIGINS_FRONT) {
    if (!originListEl) return;

    originListEl.innerHTML = "";
    originListEl.classList.add("origin-list");

    Object.values(ORIGINS_FRONT).forEach((origin) => {
        const item = document.createElement("div");
        item.className = "origin-item";
        item.dataset.value = origin.id;
        item.dataset.bg = DEFAULT_ORIGIN_BG;
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.setAttribute("aria-pressed", "false");

        item.innerHTML = `
            <div class="origin-image">
                <div class="origin-title">${origin.name}</div>
            </div>

            <div class="origin-expand">
                <div class="origin-loading-box" hidden>
                    <div class="origin-skeleton-line single"></div>

                    <div class="region-skeleton-list">
                        <div class="region-skeleton-item"></div>
                    </div>

                    <div class="origin-actions">
                        <div class="btn is-skeleton" aria-hidden="true"></div>
                        <div class="btn is-skeleton" aria-hidden="true"></div>
                    </div>
                </div>

                <div class="origin-content-box">
                    <div class="origin-desc-box"></div>
                    <div class="region-list"></div>

                    <div class="origin-actions">
                        <button type="button" class="btn secondary">지역 추가하기</button>
                        <button type="button" class="btn primary btn-next" disabled>다음</button>
                    </div>
                </div>
            </div>
        `;

        originListEl.appendChild(item);
    });
}

/**
 * origin 아이템에 이벤트를 바인딩합니다.
 * - 클릭
 * - 키보드(Enter/Space)
 * - 배경 이미지 적용
 */
export function bindOriginEvents(originListEl, { onSelectOrigin }) {
    if (!originListEl) return;

    const items = originListEl.querySelectorAll(".origin-item");

    items.forEach((el) => {
        el.addEventListener("click", () => onSelectOrigin?.(el));

        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectOrigin?.(el);
            }
        });

        const bg = el.dataset.bg || DEFAULT_ORIGIN_BG;
        el.style.setProperty("--origin-bg", `url("${bg}")`);
    });
}

/**
 * 선택된 origin UI 표시를 갱신합니다.
 */
export function setSelectedOriginItem(originListEl, selectedEl) {
    if (!originListEl || !selectedEl) return;

    originListEl.querySelectorAll(".origin-item").forEach((item) => {
        const isSelected = item === selectedEl;
        item.classList.toggle("selected", isSelected);
        item.setAttribute("aria-pressed", String(isSelected));
    });
}

/**
 * origin 카드 내부에서 확장 영역(설명/지역/버튼)을 쉽게 찾기 위한 헬퍼
 */
export function getExpandArea(originItemEl) {
    return {
        loadingBox: originItemEl?.querySelector(".origin-loading-box"),
        contentBox: originItemEl?.querySelector(".origin-content-box"),
        desc: originItemEl?.querySelector(".origin-desc-box"),
        regions: originItemEl?.querySelector(".region-list"),
        nextBtn: originItemEl?.querySelector(".origin-content-box .btn-next"),
        addBtn: originItemEl?.querySelector(".origin-content-box .origin-actions .btn.secondary"),
    };
}

/**
 * 페이지 내 모든 next 버튼을 비활성화
 */
export function disableAllNextButtons(root = document) {
    root.querySelectorAll(".btn-next").forEach((btn) => {
        btn.disabled = true;
    });
} 