// base/battle/battle.js
// - 배틀 준비 화면 UI 개선
// - 스켈레톤 UI 추가
// - 프로필 버튼 제거, 캐릭터 카드 클릭으로 character-view 이동
// - 소개 2줄 제한(능동 절단)
// - 선택 변경 버튼을 내 캐릭터 우측 상단으로 이동
// - 재매칭 버튼 제거
// - 배틀 시작 실패 시 재매칭 로직 수행
// - 정적 "전투 매칭 중" 문구 제거

import { checkBattleMatch } from "./match-client.js";
import { apiFetch } from "/base/api.js";
import { resolveCharImage } from "/base/common/image-util.js";
import { parseStoryText } from "/base/common/story-parser.js";
import { openWrap } from "/base/common/ui-wrap.js";

/* =========================
   INTERNAL: init race guard
========================= */
let __battleInitSeq = 0;

/* =========================
   UI: 스타일
========================= */
function ensureBattlePrepStyle() {
    // noop
}

/* =========================
   UTIL
========================= */
function escapeHtml(str) {
    const s = String(str ?? "");
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function trimTextForTwoLines(text, maxChars = 92) {
    const normalized = String(text || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) return "";

    if (normalized.length <= maxChars) return normalized;
    return normalized.slice(0, maxChars).trimEnd() + "...";
}

function goToCharacterView(charId) {
    if (!charId) return;
    sessionStorage.setItem("viewCharId", charId);
    window.showPage?.("character-view", {
        type: "push",
        charId
    });
}

/* =========================
   UI: 레이아웃 1회 구성
========================= */
function ensureBattlePrepLayout() {
    ensureBattlePrepStyle();

    const page =
        document.getElementById("page-battle") ||
        document.querySelector(".page.active") ||
        document.body;

    const scrollArea = page?.querySelector?.(".scroll-area") || page;

    let root = document.getElementById("battlePrepRoot");
    if (!root) {
        root = document.createElement("div");
        root.id = "battlePrepRoot";
        root.innerHTML = `
      <div class="battle-prep-stack">
        <section class="battle-panel" id="battleEnemyPanel">
          <div class="panel-title-row">
            <div class="panel-title">상대</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="badge" id="battleCacheBadge" style="display:none;">캐시</span>
            </div>
          </div>

          <div id="battleEnemyCard"></div>

          <div class="panel-subtitle">소개</div>
          <div class="battle-prompt-preview text-flow battle-intro-clamp" id="battleEnemyPrompt">상대를 탐색 중입니다...</div>

          <div class="panel-subtitle">스킬</div>
          <div class="battle-skill-row" id="battleEnemySkills"></div>
        </section>

        <section class="battle-panel" id="battleSelectPanel">
          <div class="panel-title-row">
            <div class="panel-title">내 캐릭터 선택</div>
            <button class="mini-btn" id="battleCharToggle" type="button">선택 변경</button>
          </div>

          <div id="battleMyCard"></div>

          <div class="panel-subtitle">소개</div>
          <div class="battle-prompt-preview text-flow battle-intro-clamp" id="battleMyPrompt">(선택 필요)</div>

          <div class="panel-subtitle">스킬</div>
          <div class="battle-skill-row" id="battleMySkills"></div>

          <div id="battleCharListSlot"></div>
        </section>

        <section class="battle-panel" id="battleActionPanel">
          <div class="battle-action-row">
            <div id="battleStatusSlot"></div>
            <div id="battleStartSlot"></div>
          </div>
        </section>
      </div>
    `;

        scrollArea.prepend(root);
    } else {
        if (scrollArea && root.parentElement !== scrollArea) {
            scrollArea.prepend(root);
        }
    }

    const ensureBaseEl = (id, tag = "div") => {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement(tag);
            el.id = id;
            scrollArea.appendChild(el);
        }
        return el;
    };

    const statusEl = ensureBaseEl("battleStatus", "div");
    const startBtn = ensureBaseEl("btnBattleStart", "button");
    const listEl = ensureBaseEl("battleCharList", "div");

    const statusSlot = document.getElementById("battleStatusSlot");
    const startSlot = document.getElementById("battleStartSlot");
    const listSlot = document.getElementById("battleCharListSlot");

    if (statusSlot && statusEl.parentElement !== statusSlot) statusSlot.appendChild(statusEl);
    if (startSlot && startBtn.parentElement !== startSlot) startSlot.appendChild(startBtn);
    if (listSlot && listEl.parentElement !== listSlot) listSlot.appendChild(listEl);

    startBtn.type = "button";

    return {
        root,
        statusEl,
        startBtn,
        listEl
    };
}

/* =========================
   UI: 아코디언 토글
========================= */
function toggleAccordion() {
    const body = document.getElementById("battleCharList");
    if (!body) return;
    body.style.display = body.style.display === "none" ? "grid" : "none";
}

/* =========================
   공통: 매칭 캐시 제거
========================= */
function clearBattleMatchCache(charId) {
    if (!charId) return;
    sessionStorage.removeItem(`battleMatchCache:${charId}`);
}

/* =========================
   캐시 업그레이드
========================= */
function patchBattleMatchCache(charId, enemyCharFull) {
    if (!charId || !enemyCharFull) return;

    const cacheKey = `battleMatchCache:${charId}`;
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return;

    try {
        const cache = JSON.parse(raw);
        cache.enemyChar = enemyCharFull;
        sessionStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch {
        // ignore
    }
}

/* =========================
   UI: 스켈레톤
========================= */
function renderPanelSkeleton(side) {
    const isMy = side === "my";

    const cardEl = document.getElementById(isMy ? "battleMyCard" : "battleEnemyCard");
    const promptEl = document.getElementById(isMy ? "battleMyPrompt" : "battleEnemyPrompt");
    const skillsEl = document.getElementById(isMy ? "battleMySkills" : "battleEnemySkills");

    if (cardEl) {
        cardEl.innerHTML = `
      <div class="battle-char-card battle-char-card-skeleton" aria-hidden="true">
        <div class="battle-skeleton-avatar"></div>
        <div class="battle-char-meta">
          <div class="battle-skeleton-line battle-skeleton-name"></div>
          <div class="battle-skeleton-line battle-skeleton-sub"></div>
        </div>
      </div>
    `;
    }

    if (promptEl) {
        promptEl.innerHTML = `
      <div class="battle-skeleton-text-block" aria-hidden="true">
        <div class="battle-skeleton-line"></div>
        <div class="battle-skeleton-line"></div>
      </div>
    `;
    }

    if (skillsEl) {
        skillsEl.innerHTML = `
      <span class="battle-skill-chip battle-skill-chip-skeleton"></span>
      <span class="battle-skill-chip battle-skill-chip-skeleton"></span>
      <span class="battle-skill-chip battle-skill-chip-skeleton"></span>
    `;
    }
}

/* =========================
   UI 초기화
========================= */
function resetBattleUI() {
    const { statusEl, startBtn, listEl } = ensureBattlePrepLayout();

    if (statusEl) statusEl.textContent = "상대를 탐색 중입니다...";

    if (startBtn) {
        startBtn.style.display = "none";
        startBtn.disabled = false;
        startBtn.textContent = "⚔ 배틀 시작";
        startBtn.onclick = null;
    }

    if (listEl) {
        listEl.innerHTML = "";
        listEl.style.display = "none";
    }

    renderPanelSkeleton("enemy");
    renderPanelSkeleton("my");

    const cacheBadge = document.getElementById("battleCacheBadge");
    if (cacheBadge) cacheBadge.style.display = "none";
}

/* =========================
   UI: 카드 렌더
========================= */
function renderSidePanel(side, charData, { isLoading = false } = {}) {
    const isMy = side === "my";

    const cardEl = document.getElementById(isMy ? "battleMyCard" : "battleEnemyCard");
    const promptEl = document.getElementById(isMy ? "battleMyPrompt" : "battleEnemyPrompt");
    const skillsEl = document.getElementById(isMy ? "battleMySkills" : "battleEnemySkills");

    if (!cardEl || !promptEl || !skillsEl) return;

    if (isLoading) {
        renderPanelSkeleton(side);
        return;
    }

    if (!charData) {
        cardEl.innerHTML = "<div class='battle-char-sub' style='opacity:.75'>(정보 없음)</div>";
        promptEl.textContent = "(소개 없음)";
        skillsEl.innerHTML = "";
        return;
    }

    const name = charData.displayRawName || charData.name || "(이름 없음)";
    const score = Number.isFinite(charData.battleScore) ? charData.battleScore : null;
    const region = charData.region || "";

    cardEl.innerHTML = `
    <button class="battle-char-card battle-char-card-link" type="button" data-char-id="${escapeHtml(charData.id || "")}">
      <img src="${resolveCharImage(charData.image)}" alt="" />
      <div class="battle-char-meta">
        <div class="battle-char-name">${escapeHtml(name)}</div>
        <div class="battle-char-sub">
          ${score === null ? "" : `점수 ${Number(score).toLocaleString()}점`}
          ${score !== null && region ? " · " : ""}
          ${region ? escapeHtml(region) : ""}
        </div>
      </div>
    </button>
  `;

    const cardBtn = cardEl.querySelector(".battle-char-card-link");
    if (cardBtn && charData.id) {
        cardBtn.addEventListener("click", () => {
            goToCharacterView(charData.id);
        });
    }

    const rawPrompt = typeof charData.promptRefined === "string" ? charData.promptRefined : "";
    const clampedPromptText = trimTextForTwoLines(rawPrompt, 92);

    promptEl.innerHTML = parseStoryText(clampedPromptText || "(소개 없음)");
    promptEl.title = rawPrompt || "";

    const skills = Array.isArray(charData.skills) ? charData.skills : [];
    const skillNames = skills
        .map((s) => ({ name: s?.name || "", longDesc: s?.longDesc || "" }))
        .filter((s) => s.name.trim().length > 0);

    if (!skillNames.length) {
        skillsEl.innerHTML = "<span class='battle-char-sub' style='opacity:.75'>(스킬 없음)</span>";
    } else {
        skillsEl.innerHTML = "";

        const MAX = 10;
        skillNames.slice(0, MAX).forEach((s) => {
            const chip = document.createElement("div");
            chip.className = "battle-skill-chip";
            chip.textContent = s.name;

            chip.addEventListener("click", () => {
                if (!s.longDesc) return;

                openWrap(`
          <h3 style="margin:0 0 8px;">${escapeHtml(s.name)}</h3>
          <div class="text-flow">${parseStoryText(s.longDesc)}</div>
        `);
            });

            skillsEl.appendChild(chip);
        });

        if (skillNames.length > MAX) {
            const more = document.createElement("div");
            more.className = "badge";
            more.textContent = `+${skillNames.length - MAX}개`;
            skillsEl.appendChild(more);
        }
    }
}

/* =========================
   UI: 내 캐릭터 리스트 렌더
========================= */
function renderBattleCharList(chars, selectedId) {
    const listEl = document.getElementById("battleCharList");
    const toggleBtn = document.getElementById("battleCharToggle");

    if (!listEl || !toggleBtn) return;

    listEl.innerHTML = "";

    chars.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "battle-char-item-card" + (c.id === selectedId ? " selected" : "");

        const name = c.displayRawName || c.name || "(이름 없음)";
        const score = Number.isFinite(c.battleScore) ? c.battleScore : null;

        btn.innerHTML = `
      <img src="${resolveCharImage(c.image)}" alt="" />
      <div style="min-width:0;">
        <div class="battle-char-item-name">${escapeHtml(name)}</div>
        <div class="battle-char-item-sub">${score === null ? "" : `점수 ${Number(score).toLocaleString()}점`}</div>
      </div>
    `;

        btn.onclick = async () => {
            if (c.id === selectedId) {
                listEl.style.display = "none";
                return;
            }

            sessionStorage.setItem("battleCharId", c.id);
            listEl.style.display = "none";

            await initBattlePage(true);
        };

        listEl.appendChild(btn);
    });
}

/* =========================
   캐릭터 목록 확보
========================= */
async function getMyCharactersSafe() {
    const cached = sessionStorage.getItem("homeCharacters");
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        } catch {
            sessionStorage.removeItem("homeCharacters");
        }
    }

    const res = await apiFetch("/base/characters");
    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data.characters) ? data.characters : [];
}

/* =========================
   상대 상세 불러오기
========================= */
async function fetchCharacterByIdSafe(id) {
    if (!id) return null;

    try {
        const res = await apiFetch(`/base/characters?id=${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data && typeof data === "object" ? data : null;
    } catch {
        return null;
    }
}

function hasFullCharacterShape(c) {
    if (!c || typeof c !== "object") return false;
    if (c.promptRefined) return true;
    if (Array.isArray(c.skills) && c.skills.length) return true;
    if (c.image && typeof c.image === "object") return true;
    return false;
}

/* =========================
   공통: 재매칭
========================= */
async function rematchWithMessage(message, { clearCache = true } = {}) {
    const statusEl = document.getElementById("battleStatus");
    const startBtn = document.getElementById("btnBattleStart");
    const myBattleCharId = sessionStorage.getItem("battleCharId");

    if (statusEl && message) statusEl.textContent = message;

    if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = "재매칭 중...";
    }

    if (clearCache) {
        clearBattleMatchCache(myBattleCharId);
    }

    setTimeout(async () => {
        await initBattlePage(true);
    }, 450);
}

/* =========================
   메인 진입
========================= */
export async function initBattlePage(isRetry = false) {
    const seq = ++__battleInitSeq;

    resetBattleUI();

    const { statusEl, startBtn } = ensureBattlePrepLayout();
    const toggleBtn = document.getElementById("battleCharToggle");

    if (!statusEl) return;

    try {
        const chars = await getMyCharactersSafe();
        if (seq !== __battleInitSeq) return;

        if (!chars.length) {
            statusEl.textContent = "전투할 캐릭터가 없습니다.";
            const myCard = document.getElementById("battleMyCard");
            const enemyCard = document.getElementById("battleEnemyCard");
            if (myCard) myCard.innerHTML = "<div class='battle-char-sub' style='opacity:.75'>(캐릭터 없음)</div>";
            if (enemyCard) enemyCard.innerHTML = "<div class='battle-char-sub' style='opacity:.75'>(상대 정보 없음)</div>";
            return;
        }

        let battleCharId = sessionStorage.getItem("battleCharId");
        const exists = chars.some((c) => c.id === battleCharId);

        if (!battleCharId || !exists) {
            battleCharId = chars[0].id;
            sessionStorage.setItem("battleCharId", battleCharId);
        }

        const selected = chars.find((c) => c.id === battleCharId) || chars[0];

        if (toggleBtn) {
            toggleBtn.classList.add("mini-btn");
            toggleBtn.textContent = "선택 변경";
            toggleBtn.onclick = toggleAccordion;
        }

        renderBattleCharList(chars, battleCharId);
        renderSidePanel("my", selected);

        statusEl.textContent = "상대를 탐색 중입니다...";
        renderSidePanel("enemy", null, { isLoading: true });

        const result = await checkBattleMatch();
        if (seq !== __battleInitSeq) return;

        if (!result.matched) {
            statusEl.textContent = "매칭 가능한 상대가 없습니다.";
            renderSidePanel("enemy", null, { isLoading: false });
            return;
        }

        statusEl.textContent = "매칭 완료";

        const cacheBadge = document.getElementById("battleCacheBadge");
        if (cacheBadge) cacheBadge.style.display = result.cached ? "inline-flex" : "none";

        const enemyFromMatch = result.enemyChar || null;
        const enemyId = enemyFromMatch?.id;

        let enemyFull = hasFullCharacterShape(enemyFromMatch)
            ? enemyFromMatch
            : await fetchCharacterByIdSafe(enemyId);

        if (seq !== __battleInitSeq) return;

        if (!enemyFull) {
            enemyFull = enemyFromMatch;
        }

        renderSidePanel("enemy", enemyFull);
        patchBattleMatchCache(battleCharId, enemyFull);

        if (startBtn) {
            startBtn.style.display = "inline-flex";
            startBtn.classList.add("mini-btn");
            startBtn.textContent = "⚔ 배틀 시작";

            startBtn.onclick = async () => {
                startBtn.disabled = true;
                startBtn.textContent = "전투 준비 중...";

                const myBattleCharId = sessionStorage.getItem("battleCharId");

                try {
                    const res = await apiFetch("/battle/start", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ myCharId: myBattleCharId }),
                    });

                    let data = {};
                    try {
                        data = await res.json();
                    } catch {
                        data = { error: "INVALID_JSON" };
                    }

                    if (!res.ok) {
                        await rematchWithMessage("오류가 발생해 상대를 다시 찾는 중입니다...");
                        return;
                    }

                    clearBattleMatchCache(myBattleCharId);

                    if (data?.battleId) {
                        sessionStorage.setItem("viewBattleId", data.battleId);

                        window.showPage?.("battle-log", {
                            type: "push",
                            battleId: data.battleId
                        });

                        return;
                    }

                    await rematchWithMessage("전투 정보를 다시 불러오는 중입니다...", {
                        clearCache: false
                    });
                } catch (err) {
                    console.error("🔥 START API ERROR:", err);
                    await rematchWithMessage("네트워크 문제로 상대를 다시 찾는 중입니다...");
                    return;
                }
            };
        }
    } catch (e) {
        console.error("[battle]", e);

        if (!isRetry) {
            sessionStorage.removeItem("battleCharId");
            statusEl.textContent = "캐릭터를 다시 선택합니다...";
            await initBattlePage(true);
            return;
        }

        statusEl.textContent = "매칭 실패";
    }
}