// =======================
// 🔥 raid.js (프론트 새 버전)
// =======================



// =======================
// 🔧 DOM 요소
// =======================
const bossListEl = document.getElementById("bossList");
const detailName = document.getElementById("bossName");
const btnEnter = document.getElementById("btnEnter");

const season = {
  id: 1,
  name: "침식의 계절",
  desc: "어둠이 세계를 집어삼키고 있다."
};

// 시즌 UI 세팅
document.getElementById("seasonTitle").textContent = `시즌 ${season.id} : ${season.name}`;
document.getElementById("seasonDesc").textContent = season.desc;

// =======================
// 🔥 1) 보스 목록 불러오기 (서버에서 DB 읽음)
// =======================
async function loadBosses() {
    try {
        const res = await fetch("https://ai-proxy2.vercel.app/api/raid/raid-back", {
            method: "POST",
            credentials: "include",   // ✅ 쿠키 인증
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "listBosses"
            })
        });

        const data = await res.json();

        if (!data.ok) {
            alert("보스 데이터를 불러올 수 없습니다.");
            return;
        }

        renderBossList(data.bosses);

    } catch (err) {
        console.error("loadBosses error:", err);
        alert("보스 불러오기 실패");
    }
}


// =======================
// 🔥 2) 보스 목록 렌더링
// =======================
function renderBossList(bossList) {
  bossListEl.innerHTML = "";

  bossList.forEach(boss => {
    const div = document.createElement("div");
    div.className = "boss-item";

    if (boss.isSeason) div.classList.add("season");
    if (!boss.unlocked) div.classList.add("locked");

    div.innerHTML = `
      <div class="boss-item-left">
          <div class="boss-stage">${boss.stage}</div>
          <div class="boss-name">${boss.name}</div>
      </div>
      <div class="boss-tag ${boss.unlocked ? "unlocked" : "locked"}">
          ${boss.unlocked ? "입장 가능" : boss.isSeason ? "기간 한정" : "해금 필요"}
      </div>
    `;

    div.onclick = () => selectBoss(boss);
    bossListEl.appendChild(div);
  });
}

// =======================
// 🔥 3) 보스 선택 시 상세 표시 + 레이드 생성 준비
// =======================
function selectBoss(boss) {
  detailName.textContent = boss.name;

  document.getElementById("bossSeason").textContent = boss.stage;
  document.getElementById("bossDesc").textContent = boss.desc;

  btnEnter.disabled = !boss.unlocked;
  btnEnter.textContent = boss.unlocked ? "레이드 입장" : "잠금됨";

    btnEnter.onclick = () => {
        location.href = `/raid/raid-select.html?bossId=${boss.id}`;
    };
}

async function checkLogin() {
    try {
        const res = await fetch("https://ai-proxy2.vercel.app/api/base/auth?action=me", {
            method: "GET",
            credentials: "include"
        });

        if (!res.ok) {
            alert("로그인이 필요합니다.");
            location.href = "/base/index.html";
            return false;
        }

        const data = await res.json();
        window.myUid = data.uid;
        return true;

    } catch (e) {
        alert("로그인 확인 실패");
        location.href = "/base/index.html";
        return false;
    }
}


// =======================
// 🔥 5) 최초 로드
// =======================
(async () => {
    try {
        const res = await fetch("https://ai-proxy2.vercel.app/api/base/auth?action=me", {
            method: "GET",
            credentials: "include"
        });

        if (!res.ok) {
            alert("로그인이 필요합니다.");
            location.href = "/base/index.html";
            return;
        }

        await loadBosses();

    } catch (e) {
        alert("로그인 확인 실패");
        location.href = "/base/index.html";
    }
})();








