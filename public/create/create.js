import { ORIGINS_FRONT } from "./origins.front.js";
import { openWrap } from "/base/common/ui-wrap.js";
import { apiFetch } from "/base/api.js";



/* =========================================
   2. 공통 DOM
========================================= */
const $ = (sel) => document.querySelector(sel);




const originListEl = document.getElementById("originList");



let selectedOrigin = null;
let selectedRegion = null;
/* =========================================
   🔥 CREATE PAGE RESET
========================================= */
function resetCreatePageState() {
    // JS 상태
    selectedOrigin = null;
    selectedRegion = null;

    // sessionStorage 정리
    sessionStorage.removeItem("origin");
    sessionStorage.removeItem("regionId");
    sessionStorage.removeItem("regionName");

    // DOM 상태 초기화
    document.querySelectorAll(".origin-item").forEach(el => {
        el.classList.remove("selected");
    });

    document.querySelectorAll(".region-list").forEach(el => {
        el.innerHTML = "";
        el.style.display = "none";
    });

    document.querySelectorAll(".origin-desc-box").forEach(el => {
        el.textContent = "";
        el.style.display = "none";
    });

    document.querySelectorAll(".btn-next").forEach(btn => {
        btn.disabled = true;
    });
}

function bindOriginEvents() {
    const items = document.querySelectorAll('.origin-item');

    items.forEach(el => {
        // 클릭
        el.addEventListener('click', () => selectOrigin(el));

        // 키보드 접근성
        el.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                selectOrigin(el);
            }
        });

        // 배경 이미지 적용
        const bg = el.dataset.bg;
        const img = el.querySelector('.origin-image');
        if (img && bg) {
            img.style.backgroundImage = `url(${bg})`;
        }
    });
}


function getExpandArea(el) {
    return {
        desc: el.querySelector('.origin-desc-box'),
        regions: el.querySelector('.region-list'),
        nextBtn: el.querySelector('.btn-next')
    };
}
Object.values(ORIGINS_FRONT).forEach(origin => {
    const item = document.createElement("div");
    item.className = "origin-item";
    item.dataset.value = origin.id;
    item.dataset.bg = `/images/origin/${origin.id.toLowerCase()}.jpg`; // 규칙 기반

    item.innerHTML = `
        <div class="origin-image">
            <div class="origin-title">${origin.name}</div>
        </div>

        <div class="origin-expand">
            <div class="origin-desc-box"></div>
            <div class="region-list"></div>

            <div class="origin-actions">
                <button class="btn secondary">지역 추가하기</button>
                <button class="btn primary btn-next" disabled>다음</button>
            </div>
        </div>
    `;

    originListEl.appendChild(item);
});
bindOriginEvents();
/* =========================================
   3. 기원 선택
========================================= */
function selectOrigin(el) {
    if (el.classList.contains('selected')) {
        return;
    }

    document.querySelectorAll('.origin-item')
        .forEach(i => i.classList.remove('selected'));


    // 🔥 region / 다음 버튼 상태 리셋
    selectedRegion = null;
    sessionStorage.removeItem("regionId");
    sessionStorage.removeItem("regionName");



    // 모든 next 버튼 비활성화 (안전)
    document.querySelectorAll(".btn-next").forEach(btn => {
        btn.disabled = true;
    });

    el.classList.add('selected');

    selectedOrigin = el.dataset.value;
    sessionStorage.setItem("origin", selectedOrigin);

    const ui = getExpandArea(el);

    renderOriginDetail(selectedOrigin, ui);
}





/* =========================================
   4. 기원 상세 + region 목록 서버에서 불러오기
========================================= */
async function renderOriginDetail(originName, ui) {
    ui.desc.style.display = "block";
    ui.desc.textContent = ORIGINS_FRONT[selectedOrigin]?.desc || "";


    // 🔥 렌더 전 selected 초기화
    ui.regions.querySelectorAll(".region-item").forEach(i => {
        i.classList.remove("selected");
    });
    // region 목록 초기화
    ui.regions.style.display = "block";
    ui.regions.innerHTML = "<p class='muted'>불러오는 중...</p>";



    // 서버에서 region 불러오기
    const res = await apiFetch("/base/get-regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originId: originName })
    });


    const json = await res.json();

    ui.regions.innerHTML = "";


    if (!json.ok || !Array.isArray(json.regions)) {
        ui.regions.innerHTML = "<p class='muted'>지역 정보를 불러올 수 없습니다.</p>";
        return;
    }

    // --- 지역 목록 렌더링 ---
    json.regions.forEach(r => {
        const row = document.createElement("div");
        row.className = "region-item";
        row.dataset.regionId = r.id;
        const isDefault = r.id?.endsWith("_DEFAULT");

        let ownerName = "";
        let charCountText = "";

        // 🔥 default가 아닐 때만 표시
        if (!isDefault) {

            // ownerchar가 map 구조일 경우
            if (r.ownerchar && typeof r.ownerchar === "object") {
                ownerName = r.ownerchar.name || "";
            }

            const charNum = Number.isFinite(Number(r.charnum))
                ? Number(r.charnum)
                : 0;

            ownerName = ownerName || "대표 없음";
            charCountText = `${charNum}명의 캐릭터 존재`;
        }

        row.innerHTML = `
  <div class="region-main">
      <div class="region-name">${r.name}</div>

      ${!isDefault
                ? `
        <div class="region-meta">
            <div class="region-owner">[${ownerName}]</div>
            <div class="region-count">${charCountText}</div>
        </div>
        `
                : ""
            }
  </div>

  <div class="region-actions">
      <button class="region-delete-btn"
              style="display:${r.source === "user" ? "inline-block" : "none"}">
          ✕
      </button>
      <button class="region-info-btn">i</button>
  </div>
`;






        row.addEventListener("click", () => {
            selectedRegion = r.id; // 내부 판단용

            // 🔑 서버용 / UI용 분리
            sessionStorage.setItem("regionId", r.id);     // 서버에서 쓰는 값
            sessionStorage.setItem("regionName", r.name); // 화면 표시용

            highlightSelectedRegion(r.id, ui.regions);

            ui.nextBtn.disabled = false;
        });


        // 정보 팝업
        row.querySelector(".region-info-btn").addEventListener("click", (e) => {
            e.stopPropagation();

            openWrap(`
    <h3>${r.name}</h3>
    <div class="text-flow">
      ${r.detail}
    </div>
  `);
        });
        // ❌ region 삭제
        row.querySelector(".region-delete-btn")
            .addEventListener("click", async (e) => {
                e.stopPropagation();

                const ok = confirm(`"${r.name}" 지역을 삭제하시겠습니까?`);
                if (!ok) return;

                const res = await apiFetch("/base/region-delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ regionId: r.id })
                });


                const json = await res.json();
                if (!json.ok) {
                    alert(json.error || "삭제 불가");
                    return;
                }

                // UI 갱신
                row.remove();
                if (selectedRegion === r.id) {
                    selectedRegion = null;
                    ui.nextBtn.disabled = true;
                    sessionStorage.removeItem("regionId");
                    sessionStorage.removeItem("regionName");
                }

            });

        ui.regions.appendChild(row);
    });


    // ⭐⭐⭐ 여기!! region이 0개일 때 “미지의 지역” 표시 ⭐⭐⭐
    if (json.regions.length === 0) {
        const unknown = document.createElement("div");
        unknown.className = "region-unknown-box";
        unknown.innerHTML = `
                                                                <div class="unknown-title">미지의 지역</div>
                                                                <div class="unknown-desc">
                                                                    개척되지 않은 지역, 무엇이 있을지는 모르겠다.<br>
                                                                   탐험하는 자에겐 아름다운 발견이 있을 것이다.
                                                                </div>
                                                            `;
        ui.regions.appendChild(unknown);
    }



    // --- 다음 버튼 클릭 ---
    ui.nextBtn.onclick = () => {
        if (!selectedOrigin || !selectedRegion) return;

        showPage("create-prompt");
    };


    const addBtn = ui.desc
        .closest('.origin-item')
        .querySelector('.origin-actions .btn.secondary');

    addBtn.onclick = () => {
        showPage("create-region");
    };



}

/* =========================================
   5. 지역 선택 표시
========================================= */
function highlightSelectedRegion(regionId, container) {
    container.querySelectorAll('.region-item').forEach(item => {
        item.classList.toggle(
            'selected',
            item.dataset.regionId === regionId
        );
    });
}







/* =========================================
   9. 페이지 등장 애니메이션
========================================= */
window.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
        document.body.classList.add("show");
    });
});
           
// SPA router에서 호출 가능하게 노출
window.resetCreatePageState = resetCreatePageState;


  



  
    
        