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

function escapeHtml(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
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

function renderArcanaSkeleton(listEl, count = 6) {
    if (!listEl) return;
    listEl.innerHTML = `
        <div class="arcana-list arcana-list-grid">
            ${Array.from({ length: count }).map(() => `
                <div class="arcana-card arcana-card-face skeleton" aria-hidden="true">
                    <div class="arcana-card-frame">
                        <div class="skeleton-line short"></div>
                        <div class="skeleton-block arcana-skeleton-block"></div>
                        <div class="skeleton-line"></div>
                        <div class="skeleton-line medium"></div>
                    </div>
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
        <div class="arcana-list arcana-list-grid">
            ${cards.map((card) => `
                <button class="arcana-card arcana-card-face arcana-card-${card.resultType === "loser" ? "loser" : "winner"} clickable-preview" type="button" data-battle-id="${escapeHtml(card.battleId || "")}">
                    <div class="arcana-card-frame">
                        <div class="arcana-card-top arcana-card-top-face">
                            <div class="arcana-card-name">${escapeHtml(card.tarotName || "이름 없는 카드")}</div>
                        </div>
                        <div class="arcana-card-line">${escapeHtml(card.line || "해석 없음")}</div>
                    </div>
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


function formatRemainingMs(ms = 0) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}

function getAvailabilityMessage(reason = "") {
    if (reason === "ALREADY_CREATED") return "오늘은 생성 불가";
    if (reason === "INSUFFICIENT_BATTLE_POOL") return "후보가 3개 미만이라 생성 불가";
    if (reason === "ALREADY_USED_OR_INSUFFICIENT") return "남은 후보가 3개 미만이라 생성 불가";
    return "오늘은 생성 불가";
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
                    <button class="arcana-candidate-btn arcana-card-${candidate.resultType === "loser" ? "loser" : "winner"}" type="button" data-pool-id="${escapeHtml(candidate.poolId)}">
                        <div class="arcana-candidate-top">
                            <div class="arcana-candidate-name">${escapeHtml(candidate.tarotName || "이름 없는 계시")}</div>
                        </div>
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
    const createStatusEl = document.getElementById("arcanaCreateStatus");
    const listEl = document.getElementById("arcanaList");

    let currentIsMine = false;
    let availabilityTimer = null;

    function stopAvailabilityTimer() {
        if (!availabilityTimer) return;
        clearInterval(availabilityTimer);
        availabilityTimer = null;
    }

    function applyCreateAvailability(availability = null) {
        stopAvailabilityTimer();

        const unavailable = availability && availability.state === "UNAVAILABLE";
        const nextResetAtMs = Number(availability?.nextResetAtMs) || 0;

        if (createBtn) {
            createBtn.disabled = !currentIsMine || unavailable;
            createBtn.textContent = unavailable ? "불가" : "생성";
            createBtn.classList.toggle("is-unavailable", !!unavailable);
        }

        if (!createStatusEl) return;
        if (!currentIsMine) {
            createStatusEl.textContent = "";
            return;
        }
        if (!unavailable) {
            createStatusEl.textContent = "";
            return;
        }

        const render = () => {
            const remainMs = Math.max(0, nextResetAtMs - Date.now());
            createStatusEl.textContent = `${getAvailabilityMessage(availability?.reason)} · ${formatRemainingMs(remainMs)}`;
        };

        render();
        availabilityTimer = window.setInterval(render, 1000);
    }

    if (!charId) {
        renderArcanaEmptyState(listEl, "잘못된 접근입니다.");
        return;
    }

    sessionStorage.setItem("viewCharId", charId);

    if (titleEl) titleEl.textContent = "아르카나";
    if (descEl) descEl.textContent = "전투의 여운을 카드로 새기는 중입니다.";
    if (countEl) countEl.textContent = "...";
    renderArcanaSkeleton(listEl, 6);

    async function refreshCharacterHead() {
        try {
            const res = await apiFetchCharacterById(charId);
            if (!res.ok) return;
            const data = await res.json();
            currentIsMine = !!data.isMine;
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

    async function refreshCards({ showSkeleton = true } = {}) {
        if (showSkeleton) {
            renderArcanaSkeleton(listEl, 6);
        }

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

    async function refreshCreateAvailability() {
        try {
            const res = await apiFetchArcanaCandidates(charId);
            const json = await res.json().catch(() => ({ ok: false }));
            if (!res.ok || !json.ok) {
                applyCreateAvailability(null);
                return null;
            }
            applyCreateAvailability(json.availability || null);
            return json;
        } catch (err) {
            console.error(err);
            applyCreateAvailability(null);
            return null;
        }
    }

    async function createFromCandidate(poolId) {
        if (!poolId) return;

        try {
            window.__startGlobalLoading?.();
            const res = await apiCreateArcanaCard(charId, poolId);
            const json = await res.json().catch(() => ({ ok: false }));

            if (!res.ok || !json.ok) {
                await refreshCreateAvailability();
                alert("아르카나 생성에 실패했습니다.");
                return;
            }

            const card = json.card || {};
            openWrap(`
                <div class="arcana-popup">
                    <h3>${escapeHtml(card.tarotName || "이름 없는 카드")}</h3>
                    <div class="arcana-created-line">${escapeHtml(card.line || "해석 없음")}</div>
                </div>
            `);

            await refreshCards({ showSkeleton: false });
            await refreshCreateAvailability();
        } catch (err) {
            console.error(err);
            await refreshCreateAvailability();
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

            applyCreateAvailability(json.availability || null);
            if (json.availability?.state === "UNAVAILABLE") {
                return;
            }

            const candidates = Array.isArray(json.candidates) ? json.candidates : [];
            openWrap(buildCandidatePopupHtml(candidates));

            document.querySelectorAll(".arcana-candidate-btn[data-pool-id]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const selectedPoolId = btn.getAttribute("data-pool-id") || "";
                    closeWrapOverlay();
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
    window.addEventListener("pagehide", stopAvailabilityTimer, { once: true });

    await refreshCharacterHead();
    await refreshCards();
    await refreshCreateAvailability();
}
