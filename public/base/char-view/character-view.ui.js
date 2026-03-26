// /base/char-view/character-view.ui.js//✅
import { resolveCharImage } from "../common/image-util.js";
import { parseStoryText } from "../common/story-parser.js";
import { openWrap } from "/base/common/ui-wrap.js";
import { apiFetchCharacterById, apiFetchRegionMeta, apiDownloadRegion } from "./character-view.api.js";
import {
    readHomeCharactersCache,
    writeHomeCharactersCache,
    upsertMyCharacterCache
} from "../home-cache.js";

import { renderStoryPreview, renderSkills } from "./character-view.story.js";
import { initBattleModule } from "./character-view.battle.js";

const REGION_META_TTL = 1 * 60 * 1000; // 1분

function applyEloToCharacterCache(charId, delta) {
    if (!charId || !Number.isFinite(delta)) return;

    const arr = readHomeCharactersCache();
    const idx = arr.findIndex(c => c.id === charId);
    if (idx === -1) return;

    const oldScore = Number(arr[idx].battleScore) || 0;
    arr[idx].battleScore = oldScore + delta;

    writeHomeCharactersCache(arr);
}

function renderSkeletonUI() {
    const imgEl = document.getElementById("charImage");
    const nameBox = document.getElementById("charName");
    const introBox = document.getElementById("charIntroBox");
    const content = document.getElementById("content");

    if (imgEl) imgEl.src = "/images/base/base_01.png";

    if (nameBox) {
        nameBox.innerHTML = `<div class="skeleton-line short"></div>`;
    }

    if (introBox) {
        introBox.innerHTML = `
            <div class="info-grid">
                <div class="info-cell"><div class="skeleton-line"></div></div>
                <div class="info-cell"><div class="skeleton-line"></div></div>
                <div class="info-cell"><div class="skeleton-line"></div></div>
                <div class="info-cell placeholder"></div>
            </div>
            <div class="skeleton-block"></div>
            <div class="skeleton-block"></div>
        `;
    }

    if (content) {
        content.innerHTML = `
            <div class="skeleton-block"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-block"></div>
        `;
    }
}

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
        const regionName = data.region || "-";
        const regionId = data.regionId || "";

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

        if (nameBox) {
            nameBox.textContent = data.displayRawName || "(이름 없음)";
        }

        const imgEl = document.getElementById("charImage");
        if (imgEl) {
            imgEl.src = resolveCharImage(data.image);
        }

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

                <div class="info-cell arcana-cell ${data.isMine ? "" : "placeholder"}">
                    ${data.isMine ? `
                        <button class="arcana-entry-btn" id="openArcanaBtn" type="button">
                            아르카나
                        </button>
                    ` : ""}
                </div>
            </div>

            <div class="intro-title-label">캐릭터 소개</div>
            <div class="intro-text">
                ${parseStoryText(data.promptRefined || "")}
            </div>
        `;
        }

        const originBtn = document.getElementById("originInfoBtn");
        const regionBtn = document.getElementById("regionInfoBtn");
        const arcanaBtn = document.getElementById("openArcanaBtn");

        arcanaBtn?.addEventListener("click", () => {
            sessionStorage.setItem("viewCharId", id);
            showPage("character-arcana", {
                type: "push",
                charId: id
            });
        });

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
            if (!regionId || regionId.endsWith("_DEFAULT")) {
                openWrap(`
            <h3>${regionName}</h3>
            <div class="region-detail-meta">기본 지역</div>
            <div class="text-flow">${data.regionDetail || ""}</div>
        `);
                return;
            }

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
                try {
                    const res = await apiFetchRegionMeta(regionId);
                    const json = await res.json();

                    if (!json.ok) {
                        const metaEl = document.getElementById("regionMetaInfo");
                        if (metaEl) metaEl.textContent = "정보를 불러오지 못했습니다.";
                        return;
                    }

                    setRegionMetaCache(regionId, json);

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

        fullStoryText = data.fullStory || "(스토리 없음)";
        skillsCache = data.skills || [];

        setActiveTab("story");
        renderStoryPreview({
            content,
            battlePager,
            fullStoryText,
            openDetailDialog
        });

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

    window.__closeCharacterDetailDialog = closeDetailDialog;

    if (detailDialog) {
        detailDialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            closeDetailDialog();
        });
    }

    function setActiveTab(tabName) {
        const all = [tabStory, tabSkill, tabBattle].filter(Boolean);
        all.forEach((btn) => btn.classList.remove("active"));

        if (tabName === "story") tabStory?.classList.add("active");
        if (tabName === "skill") tabSkill?.classList.add("active");
        if (tabName === "battle") tabBattle?.classList.add("active");
    }

    async function loadCharacter() {
        renderSkeletonUI();
        await new Promise(requestAnimationFrame);

        if (!id) {
            content.textContent = "잘못된 접근입니다.";
            return;
        }

        const cachedHome = readHomeCharactersCache();
        const cachedData = cachedHome.find(c => c.id === id);
        const currentRenderedId = window.__currentCharId;

        if (cachedData && currentRenderedId === id) {
            applyCharacterData(cachedData);
            return;
        }

        try {
            const res = await apiFetchCharacterById(id);

            if (!res.ok) {
                content.textContent = "권한이 없거나 캐릭터가 존재하지 않습니다.";
                return;
            }

            const data = await res.json();

            if (data.isMine) {
                upsertMyCharacterCache({
                    ...data,
                    isMine: true
                });
            }

            applyCharacterData(data);
            window.__currentCharId = data.id;

        } catch (err) {
            console.error(err);
            content.textContent = "서버 오류로 캐릭터를 불러오지 못했습니다.";
        }
    }

    loadCharacter();
}
