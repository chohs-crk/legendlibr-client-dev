// /base/character-view.ui.js
import { resolveCharImage } from "/base/common/image-util.js";

import { apiFetchCharacterById, apiFetchBattlesList } from "./character-view.api.js";

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

    let maxBattlePage = 1;

    const id =
        sessionStorage.getItem("viewCharId") ||
        new URLSearchParams(location.search).get("id");


    const BATTLE_PAGE_SIZE = 5;

    let fullStoryText = "";
    let currentBattlePage = 1;
    let battleHasMore = false;
    let battleCache = []; // 현재 페이지 전투 목록 캐시

   

    /* ===== 스토리 텍스트 파서 (기존 함수 유지) ===== */
    function parseStoryText(raw) {
        if (!raw) return "";
        let html = String(raw);

        html = html.replace(/story-(em|talk|skill)\"?>/gi, "");
        html = html.replace(/<span[^>]*>/gi, "");
        html = html.replace(/<\/span>/gi, "");
        html = html.replace(/&lt;\/?span[^&]*&gt;/gi, "");

        html = html.replace(/\*\*(.+?)\*\*/g, (_, txt) => `<span class="story-em">${txt}</span>`);

        // 대사 강조: §대사§ 형식
        html = html.replace(/§([^§]+?)§/g, (_, txt) => `"${'<span class="story-talk">' + txt + "</span>"}"`);

        html = html.replace(/『(.+?)』/g, (_, txt) => `『<span class="story-skill">${txt}</span>』`);

        html = html.replace(/\r\n/g, "\n");

        // 🔥 두 줄 이상은 문단 구분
        html = html.replace(/\n{2,}/g, "<br><br>");

        // 🔥 한 줄짜리는 그대로 두고 CSS에 맡김
        html = html.replace(/\n/g, " ");

        return html.trim();
    }

    function cacheBattle(battle) {
        const key = "battleCacheMap";
        const raw = sessionStorage.getItem(key);
        const map = raw ? JSON.parse(raw) : {};

        map[battle.id] = battle;

        sessionStorage.setItem(key, JSON.stringify(map));
    }


    function openDetailDialog(title, bodyHtml) {
        detailBody.innerHTML = `
        <h1 class="story-title">${title}</h1>
        <div class="story-box text-flow">
            ${bodyHtml}
        </div>
    `;

        document.body.classList.add("dialog-open");
        document.querySelector(".app").classList.add("is-blurred");
        detailDialog.setAttribute("open", "");
    }

    function closeDetailDialog() {
        const app = document.querySelector(".app");

        document.body.classList.remove("dialog-open");
        app.classList.remove("is-blurred");

        // ❌ detailDialog.close();
        // ❌ display 강제 리플로우 제거 (modal 전용 꼼수라 필요 없음)

        // ✅ overlay 닫기
        detailDialog.removeAttribute("open");
        detailBody.innerHTML = "";
    }
    window.__closeCharacterDetailDialog = closeDetailDialog;
    detailDialog.addEventListener("cancel", (e) => {
        e.preventDefault(); // 🔥 브라우저 뒤로가기 차단
        closeDetailDialog();
    });

    /* ===== 탭 활성화 관리 ===== */
    function setActiveTab(tabName) {
        const all = [tabStory, tabSkill, tabBattle];
        all.forEach((btn) => btn.classList.remove("active"));
        if (tabName === "story") tabStory.classList.add("active");
        if (tabName === "skill") tabSkill.classList.add("active");
        if (tabName === "battle") tabBattle.classList.add("active");
    }



    async function loadCharacter() {
        if (!id) {
            content.textContent = "잘못된 접근입니다.";
            return;
        }

        try {
            const res = await apiFetchCharacterById(id);

            if (!res.ok) {
                content.textContent = "권한이 없거나 캐릭터가 존재하지 않습니다.";
                return;
            }

            const data = await res.json(); // ✅ 여기서 data 생성
           

            /* ===== 이미지 수정 권한 처리 ===== */
            const imageBox = document.getElementById("charImageBox");
            const editIcon = document.getElementById("imageEditIcon");

            editIcon.style.display = "none";
            imageBox.classList.toggle("disabled", !data.isMine);
            // 클릭은 항상 등록
            imageBox.onclick = () => {
                if (!data.isMine) {
                    // 필요하면 여기서 토스트/알림 가능
                   

                    return;
                }
                sessionStorage.setItem("viewCharId", id);
                showPage("character-image");

            };

            // 아이콘 표시만 소유자 기준
            editIcon.style.display = data.isMine ? "flex" : "none";
            // 🔥 아이콘 클릭을 부모 클릭으로 강제 위임
            editIcon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 모바일 hit-test 우회: 부모 클릭 강제 실행
                imageBox.click();
            };

            // 이름
            nameBox.textContent = data.displayRawName || "(이름 없음)";


            // ✅ 이미지 적용
            const imgEl = document.getElementById("charImage");
            imgEl.src = resolveCharImage(data.image);

          


            // 점수 / 판수 (서버에서 battleScore, battleCount를 내려주도록 구성 필요)
            const battleScore = data.battleScore ?? 0;
            const battleCount = data.battleCount ?? 0;

            introBox.innerHTML = `
                                      <div class="info-grid">

                                        <div class="info-cell">
                                          <div class="label">지역</div>
                                       <div class="value">
    ${data.origin || "-"} - ${data.region || "-"}
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

                                        <div class="info-cell placeholder">
                                          <!-- 🔒 우측 하단: 추후 확장용 -->
                                        </div>

                                      </div>

                                      <div class="intro-title-label">캐릭터 소개</div>
                                      <div class="intro-text">
                                        ${parseStoryText(data.promptRefined || "")}
                                      </div>
`;

    
            // 스토리 원본 저장
            fullStoryText = data.fullStory || "(스토리 없음)";


            // 기본 탭: 스토리
            setActiveTab("story");
            renderStoryPreview();

            // 탭 클릭 이벤트 등록
            tabStory.onclick = () => {
                setActiveTab("story");
                renderStoryPreview();
            };

            tabSkill.onclick = () => {
                setActiveTab("skill");
                renderSkills(data.skills || []);
            };

            tabBattle.onclick = () => {
                setActiveTab("battle");
                currentBattlePage = 1;
                loadBattlePage(); // 최근 5전
            };
        } catch (err) {
            console.error(err);
            content.textContent = "서버 오류로 캐릭터를 불러오지 못했습니다.";
        }
    }

    function renderStoryPreview() {
        battlePager.style.display = "none";

        const plain = fullStoryText || "";
        const MAX = 100;

        const isOverflow = plain.length > MAX;
        const shortText = isOverflow ? plain.slice(0, MAX) + "..." : plain;

        const previewHtml = parseStoryText(shortText)
            .replace(/<br\s*\/?>/gi, " ");

        content.innerHTML = `
        <div class="story-preview clickable-preview text-flow" id="storyPreview">
            ${previewHtml || "(스토리 없음)"}
        </div>
    `;

        document.getElementById("storyPreview").addEventListener("click", () => {
            openDetailDialog("전체 스토리", parseStoryText(fullStoryText));
        });
    }


    /* ===== 스킬 탭 ===== */
    function renderSkills(skills) {
        battlePager.style.display = "none";

        if (!Array.isArray(skills) || !skills.length) {
            content.innerHTML = "<div>(스킬 없음)</div>";
            return;
        }

        content.innerHTML = skills
            .map(
                (s) => `
                          <div class="skill-box">
                            <div class="skill-name">${s.name || "이름 없음"}</div>
                            <div class="skill-desc text-flow">
  ${parseStoryText(s.longDesc || "")}
</div>

                          </div>
`
            )
            .join("");
    }

    /* ===== 전투 기록 탭 ===== */
    async function loadBattlePage() {
        if (currentBattlePage > maxBattlePage) {
            currentBattlePage = maxBattlePage;
        }
        if (currentBattlePage < 1) {
            currentBattlePage = 1;
        }

        if (!id) return;

        content.textContent = "전투 기록 불러오는 중...";
        battlePager.style.display = "none";

        try {
            const res = await apiFetchBattlesList(id, currentBattlePage, BATTLE_PAGE_SIZE);

            if (!res.ok) {
                content.textContent = "전투 기록을 불러오지 못했습니다.";
                return;
            }

            const data = await res.json();
            const totalCountNum = Number(data.totalCount);
            if (Number.isFinite(totalCountNum) && totalCountNum > 0) {
                maxBattlePage = Math.max(1, Math.ceil(totalCountNum / BATTLE_PAGE_SIZE));
            } else {
                // totalCount가 안 오거나 이상하면, 최소한 hasMore 기반으로라도 2페이지 가능성 열어둠(임시 방어)
                if (data.hasMore) maxBattlePage = Math.max(maxBattlePage, currentBattlePage + 1);
            }

        
            const battles = data.battles || [];

            battleCache = battles;
            battles.forEach(cacheBattle);

            battleHasMore = !!data.hasMore;

           

            renderBattleList(battles);
            updateBattlePager();
        } catch (err) {
            console.error(err);
            content.textContent = "전투 기록을 불러오지 못했습니다.";
        }
    }

    function updateBattlePager() {
        const pager = battlePager;
        const pagesBox = document.getElementById("battlePageNumbers");

        if (maxBattlePage <= 1) {
            pager.style.display = "none";
            return;
        }


        pager.style.display = "flex";



        // ⚠️ 지금은 예시 기준: 최대 20페이지
        const MAX_PAGE = maxBattlePage;

        const { start, end } = getPageRange(currentBattlePage, MAX_PAGE);

        // < > 표시 여부
        btnPrevPage.classList.toggle("hidden", currentBattlePage <= 1);
        btnNextPage.classList.toggle("hidden", currentBattlePage >= MAX_PAGE);


        // < > 이동 로직
        btnPrevPage.onclick = () => {
            currentBattlePage = Math.max(1, currentBattlePage - 5);
            loadBattlePage();
        };

        btnNextPage.onclick = () => {
            currentBattlePage = Math.min(MAX_PAGE, currentBattlePage + 5);
            loadBattlePage();
        };

        // 숫자 페이지 렌더
        pagesBox.innerHTML = "";

        for (let p = start; p <= end; p++) {
            const btn = document.createElement("div");
            btn.className = "pager-page" + (p === currentBattlePage ? " active" : "");
            btn.textContent = p;

            btn.onclick = () => {
                currentBattlePage = p;
                loadBattlePage();
            };

            pagesBox.appendChild(btn);
        }
  

    }

 
    function formatBattleResult(battle) {
        const myId =
            sessionStorage.getItem("viewCharId") ||
            new URLSearchParams(location.search).get("id");

        if (!battle.finished) {
            return { text: "진행중", class: "neutral" };
        }

        if (!battle.winnerId) {
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




    function getPageRange(current, total) {
        // 항상 5개 노출
        const WINDOW = 5;
        const HALF = Math.floor(WINDOW / 2);

        let start, end;

        // 앞부분 (1~3)
        if (current <= 3) {
            start = 1;
            end = Math.min(WINDOW, total);
        }
        // 뒷부분 (total-2 ~ total)
        else if (current >= total - 2) {
            end = total;
            start = Math.max(1, total - WINDOW + 1);
        }
        // 중간
        else {
            start = current - HALF;
            end = current + HALF;
        }

        return { start, end };
    }


    function formatBattlePreviewLine(battle) {
        const logs = battle.logs || [];
        if (!logs.length) return "로그 없음";
        const last = logs[logs.length - 1];
        const txt = typeof last.text === "string"
            ? last.text
            : "로그 없음";


        return txt.length > 40 ? txt.slice(0, 40) + " ..." : txt;
    }

    function renderBattleList(battles) {
        if (!battles || battles.length === 0) {
            content.innerHTML = '<div class="battle-empty">(전투 기록 없음)</div>';
            return;
        }

        content.innerHTML = `
  <div class="battle-list">
    ${battles
                .map((b, idx) => {
                    const res = formatBattleResult(b);
                    const preview = formatBattlePreviewLine(b);
                    const enemyName = b.enemyName || "전투";
                    const enemyImg = resolveCharImage(b.enemyImage);

                    return `
        <div class="battle-item clickable-preview">
          
          <!-- 상단: 상대 캐릭터 이미지 -->
          <div class="battle-thumb">
            <img src="${enemyImg}" alt="">
            <div class="battle-thumb-overlay"></div>
          </div>

          <!-- 하단: 텍스트 영역 -->
          <div class="battle-body">
           <div class="battle-title-row">
  <span class="battle-title-main">${enemyName} 전</span>
  <span class="battle-title-result ${res.class}">${res.text}</span>
</div>

<div class="battle-date">
  ${formatBattleDate(b)}
</div>

<div class="battle-sub">
  ${preview}
</div>

          </div>

        </div>
      `;
                })
                .join("")}
  </div>
`;

        // 상세 보기 버튼 이벤트
        document.querySelectorAll(".battle-item").forEach((item, idx) => {
            item.addEventListener("click", () => {
                openBattleDetail(idx);
            });
        });
    }
   


    function openBattleDetail(idx) {
        const battle = battleCache[idx];
        if (!battle) return;

        cacheBattle(battle); // 🔥 확실히 캐싱

        showPage("battle-log", {
            type: "push",
            battleId: battle.id
        });
    }




    // 초기 로드
    loadCharacter();
}


