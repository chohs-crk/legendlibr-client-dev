// /base/char-view/character-view.ui.js//✅
import { resolveCharImage } from "../common/image-util.js";
import { parseStoryText } from "../common/story-parser.js";

import { apiFetchCharacterById, apiFetchRegionMeta } from "./character-view.api.js";


import { renderStoryPreview, renderSkills } from "./character-view.story.js";
import { initBattleModule } from "./character-view.battle.js";

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

    // ✅ 배틀 탭 전용 모듈
    const battleModule = initBattleModule({
        charId: id,
        content,
        battlePager,
        btnPrevPage,
        btnNextPage,
        pageSize: BATTLE_PAGE_SIZE
    });
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
  <span class="clickable-preview" id="originInfoBtn" role="button" tabindex="0"
        style="display:inline-flex; align-items:center; text-decoration:underline;">
    ${originName}
  </span>
  <span style="opacity:0.7; padding:0 6px;">-</span>
  <span class="clickable-preview" id="regionInfoBtn" role="button" tabindex="0"
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
            const wrap = document.getElementById("regionInfoWrap");
            const content = document.getElementById("regionInfoContent");

            content.innerHTML = `
        <h3>${originName}</h3>
        <p>${data.originDesc || "설명 없음"}</p>
    `;
            wrap.classList.add("active");
        });

        regionBtn?.addEventListener("click", async () => {
            const wrap = document.getElementById("regionInfoWrap");
            const contentEl = document.getElementById("regionInfoContent");

            // 1️⃣ 먼저 기본 정보 표시 (즉시)
            contentEl.innerHTML = `
        <h3>${regionName}</h3>
        <div style="color:#999; margin-bottom:8px;">불러오는 중...</div>
        <div>${data.regionDetail || ""}</div>
    `;
            wrap.classList.add("active");

            // 2️⃣ default면 끝
            if (!regionId || regionId.endsWith("_DEFAULT")) {
                contentEl.innerHTML = `
            <h3>${regionName}</h3>
            <div style="color:#999;">기본 지역</div>
            <div>${data.regionDetail || ""}</div>
        `;
                return;
            }

            // 3️⃣ ownerchar + charnum만 호출
            try {
                const res = await apiFetchRegionMeta(regionId);
                const json = await res.json();

                if (!json.ok) return;

                contentEl.innerHTML = `
            <h3>${regionName}</h3>
            <div style="margin-bottom:8px;">
                [${json.ownerchar || "대표 없음"}] · ${json.charnum || 0}명의 캐릭터
            </div>
            <div>${data.regionDetail || ""}</div>
        `;
            } catch (e) {
                console.error(e);
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
            content.textContent = "잘못된 접근입니다.";
            return;
        }

        // 🔥 1️⃣ home 캐시 우선 확인
        const cachedHome = sessionStorage.getItem("homeCharacters");

        if (cachedHome) {
            const parsed = JSON.parse(cachedHome);
            const found = parsed.find(c => c.id === id);

            if (found) {
                applyCharacterData(found); // 🔥 UI 세팅 함수 분리
                return;
            }
        }
        try {
            const res = await apiFetchCharacterById(id);

            if (!res.ok) {
                content.textContent = "권한이 없거나 캐릭터가 존재하지 않습니다.";
                return;
            }

            const data = await res.json();
            const cachedHome = sessionStorage.getItem("homeCharacters");
            let arr = cachedHome ? JSON.parse(cachedHome) : [];

            arr = arr.filter(c => c.id !== data.id);
            arr.push(data);

            sessionStorage.setItem("homeCharacters", JSON.stringify(arr));

            applyCharacterData(data);
            
        } catch (err) {
            console.error(err);
            content.textContent = "서버 오류로 캐릭터를 불러오지 못했습니다.";
        }
    }

    // 초기 로드
    loadCharacter();
}
