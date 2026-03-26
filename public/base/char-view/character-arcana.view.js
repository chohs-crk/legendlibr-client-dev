import { openWrap } from "/base/common/ui-wrap.js";
import {
    apiFetchArcanaCandidates,
    apiFetchArcanaCards,
    apiCreateArcanaCard,
    apiFetchCharacterById
} from "./character-view.api.js";

function getCurrentCharId() {
    return (
        sessionStorage.getItem("viewCharId") ||
        new URLSearchParams(location.search).get("id") ||
        ""
    );
}

function closeWrapOverlay() {
    const overlay = document.getElementById("wrapOverlay");
    const body = document.getElementById("wrapBody");
    if (body) body.innerHTML = "";
    if (overlay) overlay.style.display = "none";
}

function formatDateTime(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${d} ${hh}:${mm}`;
}

function escapeHtml(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderArcanaEmptyState(listEl, message, sub = "") {
    if (!listEl) return;
    listEl.innerHTML = `
        <div class="arcana-empty-card">
            <div class="arcana-empty-title">${escapeHtml(message)}</div>
            ${sub ? `<div class="arcana-empty-sub">${escapeHtml(sub)}</div>` : ""}
        </div>
    `;
}

function renderArcanaSkeleton(listEl, count = 3) {
    if (!listEl) return;
    listEl.innerHTML = `
        <div class="arcana-list">
            ${Array.from({ length: count }).map(() => `
                <div class="arcana-card skeleton">
                    <div class="arcana-card-top">
                        <div class="skeleton-line short"></div>
                        <div class="skeleton-line short"></div>
                    </div>
                    <div class="skeleton-block"></div>
                    <div class="skeleton-line"></div>
                </div>
            `).join("")}
        </div>
    `;
}

function renderArcanaCards(listEl, cards = []) {
    if (!listEl) return;

    if (!Array.isArray(cards) || cards.length === 0) {
        renderArcanaEmptyState(listEl, "아직 생성된 아르카나가 없습니다.", "오늘의 전투에서 남은 계시를 카드로 새기세요.");
        return;
    }

    listEl.innerHTML = `
        <div class="arcana-list">
            ${cards.map((card) => `
                <button class="arcana-card clickable-preview" type="button" data-battle-id="${escapeHtml(card.battleId || "")}">
                    <div class="arcana-card-top">
                        <div>
                            <div class="arcana-card-name">${escapeHtml(card.tarotName || "이름 없는 카드")}</div>
                            <div class="arcana-card-meta">${escapeHtml(card.opponentName || "상대")}</div>
                        </div>
                        <div class="arcana-result-tag ${card.resultType === "loser" ? "loser" : "winner"}">
                            ${card.resultType === "loser" ? "보완" : "강화"}
                        </div>
                    </div>
                    <div class="arcana-card-line">${escapeHtml(card.line || "해석 없음")}</div>
                    <div class="arcana-card-date">${escapeHtml(formatDateTime(card.createdAtMs))}</div>
                </button>
            `).join("")}
        </div>
    `;

    listEl.querySelectorAll(".arcana-card[data-battle-id]").forEach((el) => {
        const battleId = el.getAttribute("data-battle-id") || "";
        if (!battleId) return;
        el.addEventListener("click", () => {
            showPage("battle-log", {
                type: "push",
                battleId
            });
        });
    });
}

function buildCandidatePopupHtml(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return `
            <div class="arcana-popup">
                <h3>오늘의 계시가 남아 있지 않습니다</h3>
                <div class="arcana-popup-sub">이미 모두 새겼거나, 오늘 생성 가능한 전투가 없습니다.</div>
            </div>
        `;
    }

    return `
        <div class="arcana-popup">
            <h3>오늘의 아르카나 후보</h3>
            <div class="arcana-popup-sub">세 가지 계시 중 하나를 선택해 카드로 새기세요.</div>
            <div class="arcana-candidate-list">
                ${candidates.map((candidate) => `
                    <button class="arcana-candidate-btn" type="button" data-pool-id="${escapeHtml(candidate.poolId)}">
                        <div class="arcana-candidate-top">
                            <div class="arcana-candidate-name">${escapeHtml(candidate.tarotName || "이름 없는 계시")}</div>
                            <div class="arcana-result-tag ${candidate.resultType === "loser" ? "loser" : "winner"}">
                                ${candidate.resultType === "loser" ? "보완" : "강화"}
                            </div>
                        </div>
                        <div class="arcana-candidate-meta">상대 · ${escapeHtml(candidate.opponentName || "상대")}</div>
                        <div class="arcana-candidate-preview">${escapeHtml(candidate.previewText || "전투의 여운이 아직 뜨겁게 남아 있습니다.")}</div>
                    </button>
                `).join("")}
            </div>
        </div>
    `;
}

export async function initCharacterArcanaPage() {
    const charId = getCurrentCharId();
    const titleEl = document.getElementById("arcanaTitle");
    const descEl = document.getElementById("arcanaDesc");
    const countEl = document.getElementById("arcanaCount");
    const createBtn = document.getElementById("arcanaCreateBtn");
    const listEl = document.getElementById("arcanaList");

    if (!charId) {
        renderArcanaEmptyState(listEl, "잘못된 접근입니다.");
        return;
    }

    sessionStorage.setItem("viewCharId", charId);

    async function refreshCharacterHead() {
        try {
            const res = await apiFetchCharacterById(charId);
            if (!res.ok) return;
            const data = await res.json();
            if (titleEl) {
                titleEl.textContent = `${data.displayRawName || "캐릭터"}의 아르카나`;
            }
            if (descEl) {
                descEl.textContent = data.isMine
                    ? "오늘의 전투에서 건져 올린 계시를 카드로 새깁니다."
                    : "이 아르카나는 현재 소유자만 확인할 수 있습니다.";
            }
            if (createBtn) {
                createBtn.disabled = !data.isMine;
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function refreshCards() {
        renderArcanaSkeleton(listEl, 3);

        try {
            const res = await apiFetchArcanaCards(charId);
            if (!res.ok) {
                if (res.status === 403) {
                    renderArcanaEmptyState(listEl, "이 아르카나는 소유자만 확인할 수 있습니다.");
                } else {
                    renderArcanaEmptyState(listEl, "아르카나 목록을 불러오지 못했습니다.");
                }
                if (countEl) countEl.textContent = "0장";
                return;
            }

            const json = await res.json();
            const cards = Array.isArray(json.cards) ? json.cards : [];
            if (countEl) countEl.textContent = `${cards.length}장`;
            renderArcanaCards(listEl, cards);
        } catch (err) {
            console.error(err);
            if (countEl) countEl.textContent = "0장";
            renderArcanaEmptyState(listEl, "아르카나 목록을 불러오지 못했습니다.");
        }
    }

    async function createFromCandidate(poolId) {
        if (!poolId) return;

        try {
            window.__startGlobalLoading?.();
            const res = await apiCreateArcanaCard(charId, poolId);
            const json = await res.json().catch(() => ({ ok: false }));

            if (!res.ok || !json.ok) {
                alert("아르카나 생성에 실패했습니다.");
                return;
            }

            const card = json.card || {};
            openWrap(`
                <div class="arcana-popup">
                    <h3>${escapeHtml(card.tarotName || "이름 없는 카드")}</h3>
                    <div class="arcana-popup-sub">${card.resultType === "loser" ? "보완" : "강화"}의 계시</div>
                    <div class="arcana-created-line">${escapeHtml(card.line || "해석 없음")}</div>
                </div>
            `);

            await refreshCards();
        } catch (err) {
            console.error(err);
            alert("아르카나 생성에 실패했습니다.");
        } finally {
            window.__stopGlobalLoading?.();
        }
    }

    async function openCreatePopup() {
        try {
            window.__startGlobalLoading?.();
            const res = await apiFetchArcanaCandidates(charId);
            const json = await res.json().catch(() => ({ ok: false }));

            if (!res.ok || !json.ok) {
                if (res.status === 403) {
                    alert("본인 캐릭터만 아르카나를 생성할 수 있습니다.");
                } else {
                    alert("아르카나 후보를 불러오지 못했습니다.");
                }
                return;
            }

            const candidates = Array.isArray(json.candidates) ? json.candidates : [];
            openWrap(buildCandidatePopupHtml(candidates));

            document.querySelectorAll(".arcana-candidate-btn[data-pool-id]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const selectedPoolId = btn.getAttribute("data-pool-id") || "";
                    await createFromCandidate(selectedPoolId);
                });
            });
        } catch (err) {
            console.error(err);
            alert("아르카나 후보를 불러오지 못했습니다.");
        } finally {
            window.__stopGlobalLoading?.();
        }
    }

    createBtn?.addEventListener("click", openCreatePopup);

    await refreshCharacterHead();
    await refreshCards();
}
