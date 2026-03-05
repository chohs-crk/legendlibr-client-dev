// base/battle/battle.js (UPDATED)
// - 배틀 준비 화면 UI 개선: 내 캐릭터 선택(카드형) + 상대 상세(이미지/소개/promptRefined/스킬)
// - 배틀 시작 성공 시 battle-log view로 이동

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
   - 이제 public/stylesheet/battle/battle.css 로 분리했으므로 JS 주입은 하지 않는다.
========================= */
function ensureBattlePrepStyle() {
    // noop
}

/* =========================
   UI: 레이아웃 1회 구성
   - 기존 요소(battleStatus/btnBattleStart/battleDebug/battleCharToggle/battleCharList)를 슬롯에 이동
========================= */
function ensureBattlePrepLayout() {
    ensureBattlePrepStyle();

    // ✅ scroll-area 안으로 넣어서, 새로 만든 UI가 스크롤 영역에 포함되도록 한다.
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
        <section class="battle-panel" id="battleMyPanel">
          <div class="panel-title-row">
            <div class="panel-title">내 캐릭터</div>
            <button class="mini-btn" id="btnMyProfile" type="button" style="display:none;">프로필</button>
          </div>

          <div id="battleMyCard"></div>

          <div class="panel-subtitle">소개</div>
          <div class="battle-prompt-preview text-flow" id="battleMyPrompt">(선택 필요)</div>

          <div class="panel-subtitle">스킬</div>
          <div class="battle-skill-row" id="battleMySkills"></div>
        </section>

        <section class="battle-panel" id="battleEnemyPanel">
          <div class="panel-title-row">
            <div class="panel-title">상대</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="badge" id="battleCacheBadge" style="display:none;">캐시</span>
              <button class="mini-btn" id="btnEnemyProfile" type="button" style="display:none;">프로필</button>
            </div>
          </div>

          <div id="battleEnemyCard"></div>

          <div class="panel-subtitle">소개</div>
          <div class="battle-prompt-preview text-flow" id="battleEnemyPrompt">상대를 탐색 중입니다...</div>

          <div class="panel-subtitle">스킬</div>
          <div class="battle-skill-row" id="battleEnemySkills"></div>
        </section>
      </div>

      <section class="battle-panel" id="battleSelectPanel">
        <div class="panel-title-row">
          <div class="panel-title">내 캐릭터 선택</div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="mini-btn" id="btnBattleRematch" type="button">재매칭</button>
          </div>
        </div>

        <div id="battleCharToggleSlot"></div>
        <div id="battleCharListSlot"></div>
      </section>

      <section class="battle-panel" id="battleActionPanel">
        <div class="battle-action-row">
          <div id="battleStatusSlot"></div>
          <div id="battleStartSlot"></div>
        </div>
      </section>
    `;

        // ✅ scroll-area 최상단에 삽입
        scrollArea.prepend(root);
    } else {
        // root가 있는데 scroll-area 밖에 있으면 옮김
        if (scrollArea && root.parentElement !== scrollArea) {
            scrollArea.prepend(root);
        }
    }

    // ====== 필수 base 요소가 없으면 생성 (방어) ======
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
    // ✅ 디버그 UI 제거: battleDebug는 더 이상 사용/이동하지 않는다.
    const toggleBtn = ensureBaseEl("battleCharToggle", "button");
    const listEl = ensureBaseEl("battleCharList", "div");

    // ====== 슬롯 이동 (이미 들어가 있으면 스킵) ======
    const statusSlot = document.getElementById("battleStatusSlot");
    const startSlot = document.getElementById("battleStartSlot");
    const toggleSlot = document.getElementById("battleCharToggleSlot");
    const listSlot = document.getElementById("battleCharListSlot");

    if (statusSlot && statusEl.parentElement !== statusSlot) statusSlot.appendChild(statusEl);
    if (startSlot && startBtn.parentElement !== startSlot) startSlot.appendChild(startBtn);
    if (toggleSlot && toggleBtn.parentElement !== toggleSlot) toggleSlot.appendChild(toggleBtn);
    if (listSlot && listEl.parentElement !== listSlot) listSlot.appendChild(listEl);

    // 버튼 타입 방어
    startBtn.type = "button";
    toggleBtn.type = "button";

    // rematch 버튼
    const rematchBtn = document.getElementById("btnBattleRematch");
    if (rematchBtn && rematchBtn.dataset.bound !== "1") {
        rematchBtn.dataset.bound = "1";
        rematchBtn.addEventListener("click", async () => {
            const myId = sessionStorage.getItem("battleCharId");
            if (myId) {
                sessionStorage.removeItem(`battleMatchCache:${myId}`);
            }
            await initBattlePage(true);
        });
    }

    return {
        root,
        statusEl,
        startBtn,
        toggleBtn,
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
   캐시: enemyChar를 full object로 업그레이드
   - match-client.js는 cache.enemyChar 그대로 반환하므로, 여기서 확장해두면 다음 진입부터 API 1번 절약
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
   UI 초기화
========================= */
function resetBattleUI() {
    const { statusEl, startBtn } = ensureBattlePrepLayout();

    if (statusEl) statusEl.textContent = "상대를 탐색 중입니다...";

    if (startBtn) {
        startBtn.style.display = "none";
        startBtn.disabled = false;
        startBtn.textContent = "⚔ 배틀 시작";
        startBtn.onclick = null;
    }

    // debug 제거

    // 패널 영역 초기화
    const setEmpty = (id, html = "") => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = html;
    };

    setEmpty("battleMyCard", "<div class='battle-char-sub' style='opacity:.75'>(캐릭터 선택 필요)</div>");
    setEmpty("battleEnemyCard", "<div class='battle-char-sub' style='opacity:.75'>(상대 정보 없음)</div>");

    const myPrompt = document.getElementById("battleMyPrompt");
    const enemyPrompt = document.getElementById("battleEnemyPrompt");

    if (myPrompt) myPrompt.innerHTML = "(선택 필요)";
    if (enemyPrompt) enemyPrompt.innerHTML = "상대를 탐색 중입니다...";

    setEmpty("battleMySkills", "");
    setEmpty("battleEnemySkills", "");

    const cacheBadge = document.getElementById("battleCacheBadge");
    if (cacheBadge) cacheBadge.style.display = "none";

    const btnMyProfile = document.getElementById("btnMyProfile");
    if (btnMyProfile) btnMyProfile.style.display = "none";

    const btnEnemyProfile = document.getElementById("btnEnemyProfile");
    if (btnEnemyProfile) btnEnemyProfile.style.display = "none";
}

/* =========================
   UI: 카드 렌더
========================= */
function renderSidePanel(side, charData, { isLoading = false } = {}) {
    const isMy = side === "my";

    const cardEl = document.getElementById(isMy ? "battleMyCard" : "battleEnemyCard");
    const promptEl = document.getElementById(isMy ? "battleMyPrompt" : "battleEnemyPrompt");
    const skillsEl = document.getElementById(isMy ? "battleMySkills" : "battleEnemySkills");
    const profileBtn = document.getElementById(isMy ? "btnMyProfile" : "btnEnemyProfile");

    if (!cardEl || !promptEl || !skillsEl) return;

    if (isLoading) {
        cardEl.innerHTML = "<div class='battle-char-sub' style='opacity:.75'>불러오는 중...</div>";
        promptEl.innerHTML = "...";
        skillsEl.innerHTML = "";
        if (profileBtn) profileBtn.style.display = "none";
        return;
    }

    if (!charData) {
        cardEl.innerHTML = "<div class='battle-char-sub' style='opacity:.75'>(정보 없음)</div>";
        promptEl.innerHTML = "(소개 없음)";
        skillsEl.innerHTML = "";
        if (profileBtn) profileBtn.style.display = "none";
        return;
    }

    const name = charData.displayRawName || charData.name || "(이름 없음)";
    const score = Number.isFinite(charData.battleScore) ? charData.battleScore : null;
    const region = charData.region || "";

    cardEl.innerHTML = `
    <div class="battle-char-card">
      <img src="${resolveCharImage(charData.image)}" alt="" />
      <div class="battle-char-meta">
        <div class="battle-char-name">${escapeHtml(name)}</div>
        <div class="battle-char-sub">
          ${score === null ? "" : `점수 ${Number(score).toLocaleString()}점`}
          ${score !== null && region ? " · " : ""}
          ${region ? escapeHtml(region) : ""}
        </div>
      </div>
    </div>
  `;

    // promptRefined
    const rawPrompt = typeof charData.promptRefined === "string" ? charData.promptRefined : "";
    const PROMPT_MAX = 260;
    const isLong = rawPrompt.length > PROMPT_MAX;
    const promptPreview = isLong ? rawPrompt.slice(0, PROMPT_MAX) + "..." : rawPrompt;

    promptEl.innerHTML = parseStoryText(promptPreview || "(소개 없음)");

    // (긴 경우) 더보기
    if (isLong) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "mini-btn";
        moreBtn.style.marginTop = "10px";
        moreBtn.textContent = "소개 전체보기";

        moreBtn.onclick = () => {
            openWrap(`
        <h3 style="margin:0 0 8px;">${escapeHtml(name)}</h3>
        <div class="text-flow">${parseStoryText(rawPrompt)}</div>
      `);
        };

        // 버튼 중복 방지: promptEl 아래에 삽입
        // promptEl이 innerHTML로 덮여있으니 appendChild로 안전하게 추가
        promptEl.appendChild(moreBtn);
    }

    // skills
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

    // profile button
    if (profileBtn) {
        profileBtn.style.display = "inline-flex";
        profileBtn.textContent = "프로필";

        profileBtn.onclick = () => {
            if (!charData.id) return;
            sessionStorage.setItem("viewCharId", charData.id);
            window.showPage?.("character-view", {
                type: "push",
                charId: charData.id
            });
        };
    }
}

/* =========================
   UI: 내 캐릭터 리스트 렌더
   - 카드형 그리드
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
            // 같은 캐릭터 재선택이면 아무 것도 안 함
            if (c.id === selectedId) {
                // 토글이 열린 상태면 닫아주기 정도만
                // (UX: 모바일에서 선택 후 자동으로 접히게)
                const body = document.getElementById("battleCharList");
                if (body) body.style.display = "none";
                return;
            }

            sessionStorage.setItem("battleCharId", c.id);

            // UX: 리스트 접기
            listEl.style.display = "none";

            await initBattlePage(true);
        };

        listEl.appendChild(btn);
    });
}

/* =========================
   캐릭터 목록 확보
   (home 캐시 → 서버)
========================= */
async function getMyCharactersSafe() {
    // 1️⃣ home 캐시
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

    // 2️⃣ 서버 fallback
    const res = await apiFetch("/base/characters");
    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data.characters) ? data.characters : [];
}

/* =========================
   상대 상세 불러오기
   - match API가 id만 주는 경우를 대비해 /base/characters?id= 로 보강
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
    // promptRefined/skills/image 중 하나라도 있으면 "상세"로 간주
    if (!c || typeof c !== "object") return false;
    if (c.promptRefined) return true;
    if (Array.isArray(c.skills) && c.skills.length) return true;
    if (c.image && typeof c.image === "object") return true;
    return false;
}

/* =========================
   메인 진입
========================= */
export async function initBattlePage(isRetry = false) {
    const seq = ++__battleInitSeq;

    resetBattleUI();

    const { statusEl, startBtn, toggleBtn } = ensureBattlePrepLayout();
    if (!statusEl) return;

    try {
        /* =========================
           1️⃣ 캐릭터 목록 확보
        ========================= */
        const chars = await getMyCharactersSafe();
        if (seq !== __battleInitSeq) return;

        if (!chars.length) {
            statusEl.textContent = "전투할 캐릭터가 없습니다.";
            return;
        }

        /* =========================
           2️⃣ battleCharId 보정
        ========================= */
        let battleCharId = sessionStorage.getItem("battleCharId");
        const exists = chars.some((c) => c.id === battleCharId);

        if (!battleCharId || !exists) {
            battleCharId = chars[0].id;
            sessionStorage.setItem("battleCharId", battleCharId);
        }

        const selected = chars.find((c) => c.id === battleCharId) || chars[0];

        /* =========================
           3️⃣ 내 캐릭터 선택 UI 세팅
        ========================= */
        if (toggleBtn) {
            toggleBtn.classList.add("mini-btn");
            toggleBtn.textContent = `선택 변경`;
            toggleBtn.onclick = toggleAccordion;
        }

        renderBattleCharList(chars, battleCharId);

        // 현재 선택 캐릭터 패널 렌더
        renderSidePanel("my", selected);

        /* =========================
           4️⃣ 매칭 호출
        ========================= */
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

        // enemyChar는 (1) cache 업그레이드 되어 full object일 수도 있고
        // (2) id만 있을 수도 있음
        const enemyFromMatch = result.enemyChar || null;
        const enemyId = enemyFromMatch?.id;

        let enemyFull = hasFullCharacterShape(enemyFromMatch)
            ? enemyFromMatch
            : await fetchCharacterByIdSafe(enemyId);

        if (seq !== __battleInitSeq) return;

        if (!enemyFull) {
            // 최소 정보라도 보여주기
            enemyFull = enemyFromMatch;
        }

        renderSidePanel("enemy", enemyFull);

        // ✅ 캐시에 enemy full object를 저장해 다음부터 match 호출만으로도 UI가 채워지도록
        patchBattleMatchCache(battleCharId, enemyFull);

        /* =========================
           5️⃣ 배틀 시작 버튼
        ========================= */
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
                        startBtn.disabled = false;

                        if (data.error === "ENEMY_DELETED") {
                            // ✅ 삭제된 상대면 캐시 제거 후 재매칭
                            clearBattleMatchCache(myBattleCharId);

                            startBtn.textContent = "상대가 사라졌습니다. 재매칭 중...";

                            setTimeout(async () => {
                                await initBattlePage(true);
                            }, 800);

                            return;
                        }

                        startBtn.textContent = `실패 (${res.status}): ${data.error || "UNKNOWN_ERROR"}`;
                        return;
                    }

                    // ✅ 배틀 시작 성공 시 매칭 캐시 제거
                    clearBattleMatchCache(myBattleCharId);

                    // ✅ battle-log view로 이동 (character-view.battle.js의 openBattleDetail 패턴과 동일)
                    if (data?.battleId) {
                        sessionStorage.setItem("viewBattleId", data.battleId);

                        window.showPage?.("battle-log", {
                            type: "push",
                            battleId: data.battleId
                        });

                        return;
                    }

                    // battleId가 없는 응답이면 최소 안내
                    startBtn.disabled = false;
                    startBtn.textContent = "전투 시작은 성공했지만 battleId가 없습니다.";

                } catch (err) {
                    console.error("🔥 START API ERROR:", err);

                    startBtn.disabled = false;
                    startBtn.textContent = "네트워크 오류. 콘솔 확인";
                    return;
                }
            };
        }

        /* =========================
           debug
        ========================= */
        // debug 제거

    } catch (e) {
        console.error("[battle]", e);

        // 삭제 / 불일치 복구
        if (!isRetry) {
            sessionStorage.removeItem("battleCharId");
            statusEl.textContent = "캐릭터를 다시 선택합니다...";
            await initBattlePage(true);
            return;
        }

        statusEl.textContent = "매칭 실패";
    }
}

/* =========================
   UTIL: XSS safe escape (이름/짧은 텍스트용)
   - parseStoryText는 내부적으로 HTML을 만들 수 있으므로, plain fields만 escape
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
