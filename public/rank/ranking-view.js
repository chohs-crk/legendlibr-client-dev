import { loadRankingTop100 } from "./ranking-load.js";
import { resolveCharImage } from "/base/common/image-util.js";

function resolveRankImage(item) {
    if (item.imageUrl) return item.imageUrl;
    if (item.image) return resolveCharImage(item.image);
    return "/images/base/base_01.png";
}

// 📌 export 추가: 외부(router)에서 호출할 수 있도록 함
export async function initRankingPage() {
    const listEl = document.getElementById("rankingList");
    if (!listEl) return;

    listEl.innerHTML = "<p style='color:white; text-align:center;'>랭킹 로딩 중...</p>";

    const ranking = await loadRankingTop100();
    listEl.innerHTML = ""; // 로딩 문구 제거

    ranking.forEach(item => {
        const goCharacter = () => {
            if (!item.charId) return;

            sessionStorage.setItem("viewCharId", item.charId);

            window.showPage("character-view", {
                type: "push",
                charId: item.charId
            });
        };

        if (item.rank <= 3) {
            const card = document.createElement("div");
            card.className = "rank-card top-rank clickable";
            card.innerHTML = `
            <div class="rank-bg" style="background-image:url('${resolveRankImage(item)}')"></div>
            <div class="rank-overlay">
              <div class="rank-num">${item.rank}</div>
              <div class="rank-name">${item.name}</div>
            </div>
        `;
            card.addEventListener("click", goCharacter);
            listEl.appendChild(card);
        } else {
            const row = document.createElement("div");
            row.className = "rank-row normal-rank clickable";
            row.innerHTML = `
            <div class="rank-num">${item.rank}</div>
            <div class="rank-name">${item.name}</div>
            <img class="rank-img" src="${resolveRankImage(item)}">
        `;
            row.addEventListener("click", goCharacter);
            listEl.appendChild(row);
        }
    });

}