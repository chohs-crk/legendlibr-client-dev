/**
 * create.region-ui.js
 * - 선택된 기원의 상세(설명 + 지역 목록) 렌더링
 * - 지역 선택/정보/삭제 + 다음/지역추가 버튼 로직
 */

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

  // 설명
  ui.desc.style.display = "block";
  // ✅ 기존 코드에서 selectedOrigin으로 조회하던 부분을 originId로 조회(안전)
  ui.desc.textContent = origins?.[originId]?.desc || "";

  // 다음 버튼은 기본 비활성
  ui.nextBtn.disabled = true;

  // 렌더 전 selected 초기화 (해당 origin의 region-list 기준)
  ui.regions.querySelectorAll(".region-item").forEach((i) => i.classList.remove("selected"));

  // region 목록 초기화
  ui.regions.style.display = "block";
  ui.regions.innerHTML = "<p class='muted'>불러오는 중...</p>";

  // 다음/지역추가 버튼 핸들러는 항상 세팅 (네트워크 실패 시에도 안전)
  ui.nextBtn.onclick = () => {
    if (!state?.selectedOrigin || !state?.selectedRegion) return;
    safeShowPage(showPage, "create-prompt");
  };

  if (ui.addBtn) {
    ui.addBtn.onclick = () => {
      safeShowPage(showPage, "create-region");
    };
  }

  // 서버에서 region 불러오기
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
    ui.regions.innerHTML = "<p class='muted'>지역 정보를 불러올 수 없습니다.</p>";
    return;
  }

  ui.regions.innerHTML = "";

  if (!json?.ok || !Array.isArray(json.regions)) {
    ui.regions.innerHTML = "<p class='muted'>지역 정보를 불러올 수 없습니다.</p>";
    return;
  }

  // --- 지역 목록 렌더링 ---
  json.regions.forEach((r) => {
    const row = document.createElement("div");
    row.className = "region-item";
    row.dataset.regionId = r.id;

    row.innerHTML = `
      <div class="region-main">
        <div class="region-name">${r.name}</div>
      </div>

      <div class="region-actions">
        <button class="region-delete-btn"
                style="display:${r.source === "user" ? "inline-block" : "none"}">
          ✕
        </button>
        <button class="region-info-btn">i</button>
      </div>
    `;

    // 지역 선택
    row.addEventListener("click", () => {
      setRegion?.(r.id, r.name);
      highlightSelectedRegion(r.id, ui.regions);
      ui.nextBtn.disabled = false;
    });

    // 정보 팝업
    row.querySelector(".region-info-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();

      openWrap?.(`
        <h3 class="region-detail-title">${r.name}</h3>

        <div class="region-detail-meta">
          ${
            r.source === "user"
              ? `[${r.ownerchar?.name || "대표 없음"}] · ${r.charnum || 0}명의 캐릭터`
              : "기본 지역"
          }
        </div>

        <div class="text-flow region-detail-desc">
          ${r.detail}
        </div>
      `);
    });

    // ❌ region 삭제
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

      // UI 갱신
      row.remove();

      // 삭제한 항목이 현재 선택된 region이면 상태도 정리
      if (state?.selectedRegion === r.id) {
        clearRegion?.();
        ui.nextBtn.disabled = true;
      }
    });

    ui.regions.appendChild(row);
  });

  // region이 0개일 때 “미지의 지역” 표시
  if (json.regions.length === 0) {
    renderUnknownRegion(ui.regions);
  }
}