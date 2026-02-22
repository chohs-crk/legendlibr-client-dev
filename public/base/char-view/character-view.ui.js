// /base/char-view/character-view.ui.js//✅
import { resolveCharImage } from "../common/image-util.js";
import { parseStoryText } from "../common/story-parser.js";
import { openWrap } from "/base/common/ui-wrap.js";
import { apiFetchCharacterById, apiFetchRegionMeta, apiDownloadRegion } from "./character-view.api.js";

import { renderStoryPreview, renderSkills } from "./character-view.story.js";
import { initBattleModule } from "./character-view.battle.js";
const REGION_META_TTL = 5 * 60 * 1000; // 5분

function getRegionMetaCache(regionId) {
    const raw = sessionStorage.getItem("regionMetaCache");
    if (!raw) return null;

    const map = JSON.parse(raw);
    const item = map[regionId];
    if (!item) return null;

    const now = Date.now();
    if (now - item.cachedAt > REGION_META_TTL) {
        delete map[regionId];
        sessionStorage.setItem("regionMetaCache", JSON.stringify(map));
        return null;
    }

    return item;
}

function setRegionMetaCache(regionId, data) {
    const raw = sessionStorage.getItem("regionMetaCache");
    const map = raw ? JSON.parse(raw) : {};

    map[regionId] = {
        ownerchar: data.ownerchar,
        charnum: data.charnum,
        cachedAt: Date.now()
    };

    sessionStorage.setItem("regionMetaCache", JSON.stringify(map));
}

export function initCharacterViewUI() {
    const $ = (s) => document.querySelector(s);

    const nameBox = $("#charName");
    const introBox = $("#charIntroBox");

    const tabStory = $("#tabStory");
    const tabSkill = $("#tabSkill");
    const tabBattle = $("#tabBattle");

    const content = $("#content");

    const battlePager = $("#battlePager");
    const btnPrevPage = $("#btnPrevPage");
    const btnNextPage = $("#btnNextPage");

    const detailDialog = $("#detailDialog");
    const detailBody = $("#detailBody");

    const id =
        sessionStorage.getItem("viewCharId") ||
        new URLSearchParams(location.search).get("id");

    const BATTLE_PAGE_SIZE = 5;

    let fullStoryText = "";
    let skillsCache = [];

    // ✅ 레이스 방지 토큰 (SPA에서 캐릭터 연속 클릭 시 필수)
    let loadSeq = 0;

    function setTabsEnabled(enabled) {
        [tabStory, tabSkill, tabBattle].filter(Boolean).forEach((btn) => {
            btn.classList.toggle("is-disabled", !enabled);
            btn.style.pointerEvents = enabled ? "auto" : "none";
            btn.style.opacity = enabled ? "1" : "0.65";
        });
    }

    function renderSkeleton() {
        // ✅ 이전 캐릭터 UI가 잠깐이라도 보이지 않게 "즉시" 비워준다
        if (nameBox) nameBox.textContent = ""; // 타이틀에 (로딩중..) 같은 텍스트 금지

        const imgEl = document.getElementById("charImage");
        if (imgEl) {
            // 1x1 투명 gif (이미지 깨짐 방지)
            imgEl.src =
                "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
        }

        if (introBox) {
            introBox.innerHTML = `
              <div class="info-grid">
                <div class="info-cell"><div class="sk-line w-60"></div><div class="sk-line w-40"></div></div>
                <div class="info-cell"><div class="sk-line w-40"></div><div class="sk-line w-30"></div></div>
                <div class="info-cell"><div class="sk-line w-40"></div><div class="sk-line w-30"></div></div>
                <div class="info-cell placeholder"></div>
              </div>

              <div class="intro-title-label"><div class="sk-line w-30"></div></div>
              <div class="intro-text">
                <div class="sk-block"></div>
                <div class="sk-block"></div>
                <div class="sk-block short"></div>
              </div>
            `;
        }

        if (content) {
            content.innerHTML = `
              <div class="sk-content">
                <div class="sk-block"></div>
                <div class="sk-block"></div>
                <div class="sk-block short"></div>
              </div>
            `;
        }

        if (battlePager) battlePager.style.display = "none";
        setTabsEnabled(false);

        // 탭 active도 초기화 (이전 탭 상태 유지 방지)
        [tabStory, tabSkill, tabBattle].filter(Boolean).forEach((btn) => btn.classList.remove("active"));
    }

    let battleModule = null;
    function applyCharacterData(data) {
        const originName = data.origin || "-";
        const regionName = data.region || "-"
        const regionId = data.regionId || "";

        /* ===== 이미지 수정 권한 처리 ===== */
        const imageBox = document.getElementById("charImageBox");
        const editIcon = document.getElementById("imageEditIcon");

        if (editIcon) editIcon.style.display = "none";

        if (imageBox) {
            imageBox.classList.toggle("disabled", !data.isMine);

            imageBox.onclick = () => {
                if (!data.isMine) return;
                sessionStorage.setItem("viewCharId", id);
                showPage("character-image");
            };
        }

        if (editIcon) {
            editIcon.style.display = data.isMine ? "flex" : "none";
            editIcon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                imageBox?.click();
            };
        }

        // 이름
        if (nameBox) {
            nameBox.textContent = data.displayRawName || "(이름 없음)";
        }

        // 이미지
        const imgEl = document.getElementById("charImage");
        if (imgEl) {
            imgEl.src = resolveCharImage(data.image);
        }

        // 점수/판수 + 소개
        const battleScore = data.battleScore ?? 0;
        const battleCount = data.battleCount ?? 0;

        if (introBox) {
            introBox.innerHTML = `
            <div class="info-grid">
                <div class="info-cell">
                    <div class="label">지역</div>
                   <div class="value">
  <span class="region-chip" id="originInfoBtn" role="button" tabindex="0"
        style="display:inline-flex; align-items:center; text-decoration:underline;">
    ${originName}
  </span>
  <span style="opacity:0.7; padding:0 6px;">-</span>
  <span class="region-chip" id="regionInfoBtn" role="button" tabindex="0"
        style="display:inline-flex; align-items:center; text-decoration:underline;">
    ${regionName}
  </span>
</div>

                </div>

                <div class="info-cell">
                    <div class="label">점수</div>
                    <div class="value">
                        ${battleScore.toLocaleString()}점
                    </div>
                </div>

                <div class="info-cell">
                    <div class="label">전투</div>
                    <div class="value">
                        ${battleCount}회
                    </div>
                </div>

                <div class="info-cell placeholder"></div>
            </div>

            <div class="intro-title-label">캐릭터 소개</div>
            <div class="intro-text">
                ${parseStoryText(data.promptRefined || "")}
            </div>
        `;
        }
        const originBtn = document.getElementById("originInfoBtn");
        const regionBtn = document.getElementById("regionInfoBtn");

        originBtn?.addEventListener("click", () => {
            openWrap(`
        <h3>${originName}</h3>
        <div class="region-detail-meta">기원</div>
        <div class="text-flow">
            ${data.originDesc || "설명 없음"}
        </div>
    `);
        });

          

        regionBtn?.addEventListener("click", async () => {

            // ✅ default region
            if (!regionId || regionId.endsWith("_DEFAULT")) {
                openWrap(`
            <h3>${regionName}</h3>
            <div class="region-detail-meta">기본 지역</div>
            <div class="text-flow">${data.regionDetail || ""}</div>
        `);
                return;
            }

            // ✅ 1️⃣ 즉시 팝업 열기 (placeholder 사용)
            openWrap(`
        <h3>${regionName}</h3>

        <div class="region-detail-meta" id="regionMetaInfo">
            [...] · ...명의 캐릭터
        </div>

        <div class="text-flow region-wrap-desc">
            ${data.regionDetail || ""}
        </div>

        <button id="regionDownloadBtn" class="region-wrap-download-btn">
            다운로드
        </button>
    `);

            // 다운로드 버튼 이벤트 먼저 연결
            setTimeout(() => {
                const btn = document.getElementById("regionDownloadBtn");
                if (!btn) return;

                btn.addEventListener("click", async () => {
                    try {
                        const res = await apiDownloadRegion(regionId);
                        const json = await res.json();

                        if (!json.ok) {
                            if (json.error === "ALREADY_DOWNLOADED") {
                                alert("이미 다운로드한 지역입니다.");
                            } else {
                                alert("다운로드 실패");
                            }
                            return;
                        }

                        alert("지역을 다운로드했습니다.");

                    } catch {
                        alert("서버 오류");
                    }
                });
            }, 0);
            const cached = getRegionMetaCache(regionId);

            if (cached) {
                const metaEl = document.getElementById("regionMetaInfo");
                if (metaEl) {
                    metaEl.innerHTML =
                        `[${cached.ownerchar || "대표 없음"}] · ${cached.charnum || 0}명의 캐릭터`;
                }
            } else {
            // ✅ 2️⃣ 서버 호출 (비동기)
            try {
                const res = await apiFetchRegionMeta(regionId);
                const json = await res.json();

                if (!json.ok) {
                    const metaEl = document.getElementById("regionMetaInfo");
                    if (metaEl) metaEl.textContent = "정보를 불러오지 못했습니다.";
                    return;
                }
                setRegionMetaCache(regionId, json);
                // ✅ 3️⃣ DOM 부분 교체
                const metaEl = document.getElementById("regionMetaInfo");
                if (metaEl) {
                    metaEl.innerHTML =
                        `[${json.ownerchar || "대표 없음"}] · ${json.charnum || 0}명의 캐릭터`;
                }

            } catch {
                const metaEl = document.getElementById("regionMetaInfo");
                if (metaEl) metaEl.textContent = "정보를 불러오지 못했습니다.";
                }
            }
        });





        // 스토리/스킬 캐시
        fullStoryText = data.fullStory || "(스토리 없음)";
        skillsCache = data.skills || [];

        // 기본 탭: 스토리
        setActiveTab("story");
        renderStoryPreview({
            content,
            battlePager,
            fullStoryText,
            openDetailDialog
        });

        // 탭 이벤트 (매번 덮어써도 OK)
        if (tabStory) {
            tabStory.onclick = () => {
                setActiveTab("story");
                renderStoryPreview({
                    content,
                    battlePager,
                    fullStoryText,
                    openDetailDialog
                });
            };
        }

        if (tabSkill) {
            tabSkill.onclick = () => {
                setActiveTab("skill");
                renderSkills({
                    content,
                    battlePager,
                    skills: skillsCache
                });
            };
        }

        if (tabBattle) {
            tabBattle.onclick = () => {
                setActiveTab("battle");
                battleModule.load(1);
            };
        }
    }


    function openDetailDialog(title, bodyHtml) {
        if (!detailBody || !detailDialog) return;

        detailBody.innerHTML = `
            <h1 class="story-title">${title}</h1>
            <div class="story-box text-flow">
                ${bodyHtml}
            </div>
        `;

        document.body.classList.add("dialog-open");
        document.querySelector(".app")?.classList.add("is-blurred");
        detailDialog.setAttribute("open", "");
    }

    function closeDetailDialog() {
        const app = document.querySelector(".app");

        document.body.classList.remove("dialog-open");
        app?.classList.remove("is-blurred");

        if (detailDialog) detailDialog.removeAttribute("open");
        if (detailBody) detailBody.innerHTML = "";
    }

    // 외부 닫기 훅 유지
    window.__closeCharacterDetailDialog = closeDetailDialog;

    if (detailDialog) {
        detailDialog.addEventListener("cancel", (e) => {
            e.preventDefault(); // 브라우저 기본 cancel 동작 방지
            closeDetailDialog();
        });
    }

    /* ===== 탭 활성화 ===== */
    function setActiveTab(tabName) {
        const all = [tabStory, tabSkill, tabBattle].filter(Boolean);
        all.forEach((btn) => btn.classList.remove("active"));

        if (tabName === "story") tabStory?.classList.add("active");
        if (tabName === "skill") tabSkill?.classList.add("active");
        if (tabName === "battle") tabBattle?.classList.add("active");
    }

    async function loadCharacter() {
        if (!id) {
            if (content) content.textContent = "잘못된 접근입니다.";
            return;
        }

        // ✅ 0) 진입 즉시 스켈레톤 (이전 캐릭터 화면 제거)
        renderSkeleton();

        // ✅ 1) 이번 로딩의 토큰 발급 (이전 요청 응답이 와도 덮어쓰지 못하게)
        const seq = ++loadSeq;

        // 🔥 home 캐시 우선 확인
        const cachedHome = sessionStorage.getItem("homeCharacters");
        if (cachedHome) {
            try {
                const parsed = JSON.parse(cachedHome);
                const found = parsed.find((c) => c.id === id);
                if (found) {
                    // ✅ 레이스 체크
                    if (seq !== loadSeq) return;

                    applyCharacterData(found);
                    setTabsEnabled(true);
                    return;
                }
            } catch {
                // 캐시 JSON 깨졌으면 그냥 무시하고 서버로
            }
        }

        try {
            const res = await apiFetchCharacterById(id);

            // ✅ 레이스 체크
            if (seq !== loadSeq) return;

            if (!res.ok) {
                if (content) content.textContent = "권한이 없거나 캐릭터가 존재하지 않습니다.";
                return;
            }

            const data = await res.json();

            // ✅ 레이스 체크 (json 파싱 사이에도 바뀔 수 있음)
            if (seq !== loadSeq) return;

            // homeCharacters 캐시 갱신
            const cachedHome2 = sessionStorage.getItem("homeCharacters");
            let arr = cachedHome2 ? JSON.parse(cachedHome2) : [];
            arr = arr.filter((c) => c.id !== data.id);
            arr.push(data);
            sessionStorage.setItem("homeCharacters", JSON.stringify(arr));
            // battleModule은 매 캐릭터 로딩 시 새로 생성
            battleModule = initBattleModule({
                charId: id,
                content,
                battlePager,
                btnPrevPage,
                btnNextPage,
                pageSize: BATTLE_PAGE_SIZE
            });
            applyCharacterData(data);
            setTabsEnabled(true);

        } catch (err) {
            console.error(err);
            if (seq !== loadSeq) return;
            if (content) content.textContent = "서버 오류로 캐릭터를 불러오지 못했습니다.";
        }
    }

    // 초기 로드
    loadCharacter();
}
