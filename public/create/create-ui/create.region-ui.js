/**
 * create.region-ui.js
 * - 선택된 기원의 상세(설명 + 지역 목록) 렌더링
 * - 지역 선택/정보/삭제 + 다음/지역추가 버튼 로직
 */

export function openRegionDetailModal(region, openWrap, extraHtml = "") {
    if (!region || typeof openWrap !== "function") return;

    openWrap(`
        ${extraHtml}
        <h3 class="region-detail-title">${region.name}</h3>

        <div class="region-detail-meta">
            ${region.source === "user"
                ? `[${region.ownerchar?.name || "대표 없음"}] · ${region.charnum || 0}명의 캐릭터`
                : "기본 지역"
            }
        </div>

        <div class="text-flow region-detail-desc">
            ${region.detail}
        </div>
    `);
}

function updateAddButton(ui, userRegionCount = 0) {
    if (!ui?.addBtn) return;

    const isRegionLimitReached = Number(userRegionCount) >= 10;
    ui.addBtn.style.display = isRegionLimitReached ? "none" : "inline-flex";
    ui.addBtn.disabled = isRegionLimitReached;
}

/**
 * 지역 선택 UI(하이라이트)
 */
export function highlightSelectedRegion(regionId, container) {
    if (!container) return;

    container.querySelectorAll(".region-item").forEach((item) => {
        item.classList.toggle("selected", item.dataset.regionId === regionId);
    });
}

function renderUnknownRegion(container) {
    const unknown = document.createElement("div");
    unknown.className = "region-unknown-box";
    unknown.innerHTML = `
        <div class="unknown-title">미지의 지역</div>
        <div class="unknown-desc">
            개척되지 않은 지역, 무엇이 있을지는 모르겠다.<br>
            탐험하는 자에겐 아름다운 발견이 있을 것이다.
        </div>
    `;
    container.appendChild(unknown);
}

function safeShowPage(showPage, pageName) {
    if (typeof showPage === "function") {
        showPage(pageName);
        return;
    }
    console.warn(`[create] showPage is not a function. tried to navigate: ${pageName}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRegionRow(r, { ui, openWrap, apiFetch, state, setRegion, clearRegion }) {
    const row = document.createElement("div");
    row.className = "region-item";
    row.dataset.regionId = r.id;

    row.innerHTML = `
        <div class="region-main">
            <div class="region-name">${r.name}</div>
        </div>

        <div class="region-actions">
            <button
                class="region-delete-btn"
                style="display:${r.source === "user" ? "inline-block" : "none"}"
            >
                ✕
            </button>
            <button class="region-info-btn">i</button>
        </div>
    `;

    row.addEventListener("click", () => {
        setRegion?.(r.id, r.name);
        highlightSelectedRegion(r.id, ui.regions);
        ui.nextBtn.disabled = false;
    });

    row.querySelector(".region-info-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();

        openRegionDetailModal(r, openWrap);
    });

    row.querySelector(".region-delete-btn")?.addEventListener("click", async (e) => {
        e.stopPropagation();

        const ok = confirm(`"${r.name}" 지역을 삭제하시겠습니까?`);
        if (!ok) return;

        let delJson;
        try {
            const res = await apiFetch("/base/region-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ regionId: r.id }),
            });
            delJson = await res.json();
        } catch (err) {
            console.error(err);
            alert("삭제 중 오류가 발생했습니다.");
            return;
        }

        if (!delJson?.ok) {
            alert(delJson?.error || "삭제 불가");
            return;
        }

        row.remove();

        if (state?.selectedRegion === r.id) {
            clearRegion?.();
            ui.nextBtn.disabled = true;
        }

        if (typeof ui.__userRegionCount === "number") {
            ui.__userRegionCount = Math.max(0, ui.__userRegionCount - 1);
            updateAddButton(ui, ui.__userRegionCount);
        }

        if (!ui.regions.querySelector(".region-item")) {
            renderUnknownRegion(ui.regions);
        }
    });

    return row;
}

async function appendRegionsSequentially(regions, deps) {
    const { ui } = deps;

    for (let i = 0; i < regions.length; i += 1) {
        const row = createRegionRow(regions[i], deps);

        if (i > 0) {
            row.classList.add("region-enter");
        }

        ui.regions.appendChild(row);

        if (i > 0) {
            requestAnimationFrame(() => {
                row.classList.add("region-enter-active");
            });
            await sleep(100);
        }
    }
}

/**
 * 선택된 origin의 상세를 렌더링합니다.
 */
export async function renderOriginDetail({
    originId,
    ui,
    origins,
    apiFetch,
    openWrap,
    state,
    setRegion,
    clearRegion,
    showPage,
}) {
    if (!ui?.desc || !ui?.regions || !ui?.nextBtn) return;

    ui.nextBtn.onclick = () => {
        if (!state?.selectedOrigin || !state?.selectedRegion) return;
        safeShowPage(showPage, "create-prompt");
    };

    if (ui.addBtn) {
        ui.addBtn.onclick = () => {
            safeShowPage(showPage, "create-region");
        };
    }

    let json;
    try {
        const res = await apiFetch("/base/get-regions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ originId }),
        });
        json = await res.json();
    } catch (err) {
        console.error(err);
        ui.desc.style.display = "block";
        ui.desc.textContent = origins?.[originId]?.desc || "";
        ui.regions.style.display = "block";
        ui.regions.innerHTML = "<p class='muted'>지역 정보를 불러올 수 없습니다.</p>";
        ui.nextBtn.disabled = true;
        ui.nextBtn.style.display = "inline-flex";

        if (ui.addBtn) {
            ui.addBtn.style.display = "inline-flex";
            ui.addBtn.disabled = false;
        }
        return;
    }

    ui.desc.style.display = "block";
    ui.desc.textContent = origins?.[originId]?.desc || "";

    ui.regions.style.display = "grid";
    ui.regions.innerHTML = "";

    if (!json?.ok || !Array.isArray(json.regions)) {
        ui.regions.innerHTML = "<p class='muted'>지역 정보를 불러올 수 없습니다.</p>";
        ui.nextBtn.disabled = true;
        ui.nextBtn.style.display = "inline-flex";

        if (ui.addBtn) {
            ui.addBtn.style.display = "inline-flex";
            ui.addBtn.disabled = false;
        }
        return;
    }

    const userRegionCount = Number(json?.userRegionCount) || 0;
    ui.__userRegionCount = userRegionCount;
    updateAddButton(ui, userRegionCount);

    ui.nextBtn.style.display = "inline-flex";
    ui.nextBtn.disabled = true;

    if (json.regions.length === 0) {
        renderUnknownRegion(ui.regions);
        return;
    }

    await appendRegionsSequentially(json.regions, {
        ui,
        openWrap,
        apiFetch,
        state,
        setRegion,
        clearRegion,
    });
} 