import { loadRankingTop100 } from "./ranking-load.js";
import { resolveCharImage } from "/base/common/image-util.js";

function resolveRankImage(item) {
    if (item.imageUrl) return item.imageUrl;
    if (item.image) return resolveCharImage(item.image);
    return "/images/base/base_01.png";
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => {
        switch (ch) {
            case "&": return "&amp;";
            case "<": return "&lt;";
            case ">": return "&gt;";
            case '"': return "&quot;";
            case "'": return "&#39;";
            default: return ch;
        }
    });
}

function truncateName(name, max = 8) {
    const text = String(name ?? "");
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
}

function renderRankingSkeleton(listEl) {
    listEl.innerHTML = `
        <div class="rank-card top-rank rank-1 rank-skeleton">
            <div class="rank-skeleton-shimmer"></div>
            <div class="rank-top-skeleton-overlay">
                <div class="rank-top-skeleton-num"></div>
                <div class="rank-top-skeleton-bottom">
                    <div class="rank-top-skeleton-name"></div>
                    <div class="rank-top-skeleton-elo"></div>
                </div>
            </div>
        </div>

        <div class="rank-card top-rank rank-2 rank-skeleton">
            <div class="rank-skeleton-shimmer"></div>
            <div class="rank-top-skeleton-overlay">
                <div class="rank-top-skeleton-num"></div>
                <div class="rank-top-skeleton-bottom">
                    <div class="rank-top-skeleton-name"></div>
                    <div class="rank-top-skeleton-elo"></div>
                </div>
            </div>
        </div>

        <div class="rank-card top-rank rank-3 rank-skeleton">
            <div class="rank-skeleton-shimmer"></div>
            <div class="rank-top-skeleton-overlay">
                <div class="rank-top-skeleton-num"></div>
                <div class="rank-top-skeleton-bottom">
                    <div class="rank-top-skeleton-name"></div>
                    <div class="rank-top-skeleton-elo"></div>
                </div>
            </div>
        </div>

        ${Array.from({ length: 7 }).map(() => `
            <div class="rank-row normal-rank rank-skeleton">
                <div class="rank-row-normal-skeleton-num"></div>
                <div class="rank-row-normal-skeleton-img"></div>
                <div class="rank-row-normal-skeleton-name"></div>
                <div class="rank-row-normal-skeleton-elo"></div>
                <div class="rank-skeleton-shimmer"></div>
            </div>
        `).join("")}
    `;
}

// 📌 export 추가: 외부(router)에서 호출할 수 있도록 함
export async function initRankingPage() {
    const listEl = document.getElementById("rankingList");
    if (!listEl) return;

    renderRankingSkeleton(listEl);

    const ranking = await loadRankingTop100();
    listEl.innerHTML = "";

    if (!Array.isArray(ranking) || ranking.length === 0) {
        listEl.innerHTML = "<p style='color:white; text-align:center;'>랭킹 데이터가 없습니다.</p>";
        return;
    }

    ranking.forEach(item => {
        const goCharacter = () => {
            if (!item.charId) return;

            sessionStorage.setItem("viewCharId", item.charId);

            window.showPage("character-view", {
                type: "push",
                charId: item.charId
            });
        };

        const safeName = escapeHtml(item.name ?? "");
        const displayName = escapeHtml(truncateName(item.name ?? "", 8));
        const eloValue = escapeHtml(item.elo ?? item.rankScore ?? 0);
        const imageUrl = resolveRankImage(item);

        if (item.rank <= 3) {
            const card = document.createElement("div");
            card.className = `rank-card top-rank rank-${item.rank} clickable`;
            card.innerHTML = `
                <div class="rank-bg" style="background-image:url('${imageUrl}')"></div>
                <div class="rank-overlay">
                    <div class="rank-num">${item.rank}</div>
                    <div>
                        <div class="rank-name">${safeName}</div>
                        <div class="rank-elo">ELO ${eloValue}</div>
                    </div>
                </div>
            `;
            card.addEventListener("click", goCharacter);
            listEl.appendChild(card);
        } else {
            const row = document.createElement("div");
            row.className = "rank-row normal-rank clickable";
            row.innerHTML = `
                <div class="rank-num">${item.rank}</div>
                <img
                    class="rank-img"
                    src="${imageUrl}"
                    alt="${safeName}"
                    loading="lazy"
                    decoding="async"
                >
                <div class="rank-name" title="${safeName}">${displayName}</div>
                                <div class="rank-elo">ELO ${eloValue}</div>
            `;
            row.addEventListener("click", goCharacter);
            listEl.appendChild(row);
        }
    });
}