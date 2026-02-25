// /base/char-view/character-view.battle.js//✅
import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetchBattlesList } from "./character-view.api.js";
import { parseStoryText } from "/base/common/story-parser.js";


/**
 * 전투 기록 탭 모듈
 * - 목록 렌더 + 페이징 + 상세 진입(showPage) + battleCacheMap(sessionStorage) 저장
 */
export function initBattleModule({
    charId,
    content,
    battlePager,
    btnPrevPage,
    btnNextPage,
    pageSize = 5
}) {
    const pagesBox = document.getElementById("battlePageNumbers");

    let maxBattlePage = 1;
    let currentBattlePage = 1;
    let battleCache = []; // 현재 페이지 전투 목록 캐시
    function createDotLoader(baseText = "전투 진행 중") {
        const span = document.createElement("span");
        span.className = "dot-loader";
        span.textContent = baseText + " .";

        let dotCount = 1;

        const interval = setInterval(() => {
            dotCount = dotCount >= 3 ? 1 : dotCount + 1;
            span.textContent = baseText + " " + ".".repeat(dotCount);
        }, 500);

        span.__dotInterval = interval;
        return span;
    }

    function cacheBattle(battle) {
        if (!battle?.id) return;

        const key = "battleCacheMap";
        const raw = sessionStorage.getItem(key);
        const map = raw ? JSON.parse(raw) : {};
        map[battle.id] = battle;
        sessionStorage.setItem(key, JSON.stringify(map));
    }

    function getMyCharId() {
        return (
            charId ||
            sessionStorage.getItem("viewCharId") ||
            new URLSearchParams(location.search).get("id")
        );
    }

    function clampPage(p) {
        if (!Number.isFinite(p)) return 1;
        if (p < 1) return 1;
        if (p > maxBattlePage) return maxBattlePage;
        return p;
    }

    async function load(page = 1) {
        if (!content) return;

        const myId = getMyCharId();
        if (!myId) {
            content.textContent = "잘못된 접근입니다.";
            if (battlePager) battlePager.style.display = "none";
            return;
        }

        currentBattlePage = clampPage(Number(page));

        content.textContent = "전투 기록 불러오는 중...";
        if (battlePager) battlePager.style.display = "none";

        try {
            const res = await apiFetchBattlesList(myId, currentBattlePage, pageSize);

            if (!res.ok) {
                content.textContent = "전투 기록을 불러오지 못했습니다.";
                return;
            }

            const data = await res.json();

            const totalCountNum = Number(data.totalCount);
            if (Number.isFinite(totalCountNum) && totalCountNum > 0) {
                maxBattlePage = Math.max(1, Math.ceil(totalCountNum / pageSize));
            } else {
                // totalCount가 없으면 hasMore 기반으로 최소 방어
                if (data.hasMore) {
                    maxBattlePage = Math.max(maxBattlePage, currentBattlePage + 1);
                } else {
                    maxBattlePage = Math.max(1, maxBattlePage);
                }
            }

            // maxBattlePage가 갱신되면서 current가 초과할 수 있어 재클램프
            currentBattlePage = clampPage(currentBattlePage);

            const battles = data.battles || [];
            battleCache = battles;

            battles.forEach(cacheBattle);

            renderBattleList(battles);
            updateBattlePager();
        } catch (err) {
            console.error(err);
            content.textContent = "전투 기록을 불러오지 못했습니다.";
        }
    }

    function updateBattlePager() {
        if (!battlePager) return;

        if (maxBattlePage <= 1) {
            battlePager.style.display = "none";
            return;
        }

        battlePager.style.display = "flex";

        const MAX_PAGE = maxBattlePage;
        const { start, end } = getPageRange(currentBattlePage, MAX_PAGE);

        if (btnPrevPage) {
            btnPrevPage.classList.toggle("hidden", currentBattlePage <= 1);
            btnPrevPage.onclick = () => {
                load(Math.max(1, currentBattlePage - 5));
            };
        }

        if (btnNextPage) {
            btnNextPage.classList.toggle("hidden", currentBattlePage >= MAX_PAGE);
            btnNextPage.onclick = () => {
                load(Math.min(MAX_PAGE, currentBattlePage + 5));
            };
        }

        if (!pagesBox) return;
        pagesBox.innerHTML = "";

        for (let p = start; p <= end; p++) {
            const btn = document.createElement("div");
            btn.className = "pager-page" + (p === currentBattlePage ? " active" : "");
            btn.textContent = p;

            btn.onclick = () => load(p);
            pagesBox.appendChild(btn);
        }
    }

    function getPageRange(current, total) {
        const WINDOW = 5;
        const HALF = Math.floor(WINDOW / 2);

        let start, end;

        if (current <= 3) {
            start = 1;
            end = Math.min(WINDOW, total);
        } else if (current >= total - 2) {
            end = total;
            start = Math.max(1, total - WINDOW + 1);
        } else {
            start = current - HALF;
            end = current + HALF;
        }

        return { start, end };
    }

    function formatBattleResult(battle) {
        const myId = getMyCharId();

        if (!battle?.finished) {
            return { text: "진행중", class: "neutral" };
        }

        if (!battle?.winnerId) {
            return { text: "", class: "neutral" };
        }

        if (battle.winnerId === myId) {
            return { text: "승", class: "win" };
        }

        if (battle.loserId === myId) {
            return { text: "패", class: "lose" };
        }

        return { text: "", class: "neutral" };
    }

    function formatBattleDate(battle) {
        if (!battle?.createdAt) return "";

        const dateObj = new Date(battle.createdAt);
        if (isNaN(dateObj.getTime())) return "";

        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(dateObj.getDate()).padStart(2, "0");
        const hh = String(dateObj.getHours()).padStart(2, "0");
        const mm = String(dateObj.getMinutes()).padStart(2, "0");

        return `${y}.${m}.${d} ${hh}:${mm}`;
    }

    function formatBattlePreviewLine(battle) {
        // 🔥 전투 진행 중
        if (!battle?.finished) {
            return "__LOADING__";
        }
        const logs = battle?.logs || [];
        if (!logs.length) return "로그 없음";

        const last = logs[logs.length - 1];
        const raw = typeof last?.text === "string" ? last.text : "로그 없음";

        // 1️⃣ 먼저 순수 텍스트 기준으로 줄이기
        const MAX_LEN = 80;

        // 줄바꿈 정리
        const normalized = raw.replace(/\r\n/g, "\n").trim();

        if (normalized.length <= MAX_LEN) {
            return parseStoryText(normalized);
        }

        // 단어 중간에서 끊기지 않게 자르기
        let sliced = normalized.slice(0, MAX_LEN);

        const lastSpace = sliced.lastIndexOf(" ");
        if (lastSpace > 40) {
            sliced = sliced.slice(0, lastSpace);
        }

        // 2️⃣ 잘린 텍스트를 다시 parser에 넣는다
        const safeHtml = parseStoryText(sliced);

        return safeHtml + " ...";
    }



    function renderBattleList(battles) {
        if (!content) return;

        if (!battles || battles.length === 0) {
            content.innerHTML = '<div class="battle-empty">(전투 기록 없음)</div>';
            return;
        }

        content.innerHTML = `
            <div class="battle-list">
                ${battles
                .map((b) => {
                    const res = formatBattleResult(b);
                    const previewRaw = formatBattlePreviewLine(b);
                    const myId = getMyCharId();

                    // 내가 공격자인지 수비자인지 판별
                    const isAttacker = b.myId === myId;

                    const opponentId = isAttacker ? b.enemyId : b.myId; //더미
                    const opponentName = isAttacker
                        ? (b.enemyName || "상대")
                        : (b.myName || "상대");

                    const opponentImage = isAttacker
                        ? (b.enemyImage || null)
                        : (b.myImage || null);


                    // 내 elo 변동
                    const myDelta = isAttacker ? b.myEloDelta : b.enemyEloDelta;

                    const delta = Number.isFinite(myDelta) ? myDelta : null;

                    const deltaText =
                        delta === null
                            ? ""
                            : delta > 0
                                ? `+${delta}`
                                : `${delta}`;

                    const deltaClass =
                        delta === null
                            ? ""
                            : delta > 0
                                ? "elo-plus"
                                : delta < 0
                                    ? "elo-minus"
                                    : "elo-zero";



                    return `
<div class="battle-item clickable-preview ${res.class}">


  <div class="battle-thumb">
    <img src="${resolveCharImage(opponentImage)}" alt="">
  </div>

  <div class="battle-body">
    <div class="battle-title-row">
      <span class="battle-title-main">${opponentName} 전</span>
      <span class="battle-title-result ${res.class}">${res.text}</span>
    </div>

    <div class="battle-elo ${deltaClass}">
      ${deltaText}
    </div>

    <div class="battle-date">
      ${formatBattleDate(b)}
    </div>

    <div class="battle-sub" data-loading="${previewRaw === "__LOADING__"}">
  ${previewRaw === "__LOADING__" ? "" : previewRaw}
</div>
  </div>
</div>
`;

                })
                .join("")}
            </div>
        `;

        document.querySelectorAll(".battle-item").forEach((item, idx) => {
            item.addEventListener("click", () => {
                openBattleDetail(idx);
            });
        });
        document.querySelectorAll(".battle-sub").forEach(el => {
            if (el.dataset.loading === "true") {
                const loader = createDotLoader("전투 진행 중");
                el.appendChild(loader);
            }
        });
    }

    function openBattleDetail(idx) {
        const battle = battleCache[idx];
        if (!battle) return;

        cacheBattle(battle);

        // battle-log 페이지는 router에서 battleId 기반으로 처리
        showPage("battle-log", {
            type: "push",
            battleId: battle.id
        });
    }

    return {
        load
    };
}
