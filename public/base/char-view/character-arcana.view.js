import { openWrap } from "/base/common/ui-wrap.js";
import { bindTimedInfoTip } from "/base/common/timed-info-tip.js";
import { apiFetch } from "/base/api.js";
import {
    apiFetchArcanaCandidates,
    apiFetchArcanaCards,
    apiCreateArcanaCard,
    apiFetchCharacterById
} from "./character-view.api.js";
import { upsertMyCharacterCache } from "../home-cache.js";

const ARCANA_MAX_EQUIPPED = 3;
const ARCANA_DAY_MS = 24 * 60 * 60 * 1000;
const ARCANA_INFO_MESSAGE = "최대 3장 장착, 생성된 지 30일이 지나면 사용 불가";
const ARCANA_STAR_PATH = "M12 1.75C13.19 6.36 16.64 9.81 21.25 11C16.64 12.19 13.19 15.64 12 20.25C10.81 15.64 7.36 12.19 2.75 11C7.36 9.81 10.81 6.36 12 1.75Z";

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
                        <div class="arcana-skeleton-top">
                            <div class="skeleton-pill"></div>
                            <div class="skeleton-star"></div>
                        </div>
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

function formatRemainingMs(ms = 0) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}

function formatExpireLabel(card = {}) {
    if (card.expired) return "사용 불가";

    const expiresAtMs = Number(card.expiresAtMs) || 0;
    if (expiresAtMs <= 0) return "기한 없음";

    const remainMs = Math.max(0, expiresAtMs - Date.now());
    const remainDays = Math.ceil(remainMs / ARCANA_DAY_MS);
    return `D-${remainDays}`;
}

function getEquipButtonLabel(card = {}) {
    if (card.equipped) return "해제";
    if (card.expired) return "사용 불가";
    return "장착";
}

function buildSparkIconHtml({ active = false, className = "" } = {}) {
    const classes = [
        "arcana-card-state-icon",
        active ? "is-active" : "is-inactive",
        className
    ].filter(Boolean).join(" ");

    return `
        <span class="${classes}" role="img" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="${ARCANA_STAR_PATH}"></path>
            </svg>
        </span>
    `;
}

function buildEquippedStarsHtml(equippedCount = 0, maxEquippedSlots = ARCANA_MAX_EQUIPPED) {
    const safeCount = Math.max(0, Math.min(Number(equippedCount) || 0, maxEquippedSlots));
    return `
        <div class="arcana-equipped-row-stars" aria-label="장착 ${safeCount}/${maxEquippedSlots}">
            ${Array.from({ length: maxEquippedSlots }).map((_, index) => `
                <span class="arcana-equipped-star ${index < safeCount ? "is-active" : "is-inactive"}" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <path d="${ARCANA_STAR_PATH}"></path>
                    </svg>
                </span>
            `).join("")}
        </div>
    `;
}

function buildCardMetaHtml(card = {}) {
    return `
        <div class="arcana-card-topline">
            <div class="arcana-badge ${card.expired ? "is-expired" : "is-usable"}">${escapeHtml(formatExpireLabel(card))}</div>
            ${buildSparkIconHtml({ active: !!card.equipped })}
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
            ${cards.map((card) => {
                const battleId = escapeHtml(card.battleId || "");
                const canNavigate = !!card.battleId;

                return `
                    <div
                        class="arcana-card arcana-card-face arcana-card-${card.resultType === "loser" ? "loser" : "winner"} ${canNavigate ? "is-battle-link" : ""}"
                        ${canNavigate ? `data-battle-id="${battleId}" tabindex="0" role="button" aria-label="${escapeHtml((card.tarotName || "이름 없는 카드"))} 전투로 이동"` : ""}
                    >
                        <div class="arcana-card-frame">
                            ${buildCardMetaHtml(card)}
                            <div class="arcana-card-name">${escapeHtml(card.tarotName || "이름 없는 카드")}</div>
                            <div class="arcana-card-line">${escapeHtml(card.line || "해석 없음")}</div>
                            <div class="arcana-card-actions">
                                <button
                                    class="arcana-card-subbtn arcana-card-equip-btn ${card.equipped ? "is-equipped" : ""} ${card.expired && !card.equipped ? "is-disabled" : ""}"
                                    type="button"
                                    data-card-id="${escapeHtml(card.id || "")}" 
                                    data-card-name="${escapeHtml(card.tarotName || "")}" 
                                    ${card.expired && !card.equipped ? "disabled" : ""}
                                >
                                    ${escapeHtml(getEquipButtonLabel(card))}
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
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
            <div class="arcana-popup-sub">세 장 중 하나를 골라 카드로 새기세요.</div>
            <div class="arcana-candidate-list">
                ${candidates.map((candidate) => `
                    <button class="arcana-candidate-btn arcana-card-${candidate.resultType === "loser" ? "loser" : "winner"}" type="button" data-pool-id="${escapeHtml(candidate.poolId)}">
                        <div class="arcana-candidate-top">
                            <div class="arcana-candidate-name">${escapeHtml(candidate.tarotName || "이름 없는 계시")}</div>
                        </div>
                    </button>
                `).join("")}
            </div>
        </div>
    `;
}

function buildReplacePopupHtml(targetCard = {}, equippedCards = []) {
    return `
        <div class="arcana-popup">
            <h3>어떤 걸 대체하겠습니까?</h3>
            <div class="arcana-popup-sub">${escapeHtml(targetCard.tarotName || "이 카드")}를 장착하면 아래 카드 하나가 빠집니다.</div>
            <div class="arcana-replace-list">
                ${equippedCards.map((card) => `
                    <button class="arcana-replace-btn arcana-card-${card.resultType === "loser" ? "loser" : "winner"}" type="button" data-replace-card-id="${escapeHtml(card.id || "")}">
                        <div class="arcana-replace-name">${escapeHtml(card.tarotName || "이름 없는 카드")}</div>
                        <div class="arcana-replace-line">${escapeHtml(card.line || "해석 없음")}</div>
                        <div class="arcana-replace-meta">${card.expired ? "사용 불가 상태" : "현재 장착 중"}</div>
                    </button>
                `).join("")}
            </div>
        </div>
    `;
}

async function apiUpdateArcanaEquip({ charId, cardId, action, replaceCardId = "" }) {
    return apiFetch("/base/arcana-equip", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            charId,
            cardId,
            action,
            replaceCardId
        })
    });
}

function syncMyCharacterArcanaCount(character = {}, equippedCount = 0, maxEquippedSlots = ARCANA_MAX_EQUIPPED) {
    if (!character?.isMine || !character?.id) return;

    upsertMyCharacterCache({
        ...character,
        isMine: true,
        arcanaEquippedCount: Math.max(0, Number(equippedCount) || 0),
        arcanaMaxEquippedSlots: Math.max(1, Number(maxEquippedSlots) || ARCANA_MAX_EQUIPPED)
    });
}

function ensureSummaryInfoUi({ countEl, isMine }) {
    const summaryBox = countEl?.closest(".arcana-summary-box");
    if (!summaryBox) return { infoButton: null, equippedRow: null };

    summaryBox.classList.add("is-enhanced");

    let labelEl = summaryBox.querySelector(".arcana-summary-label");
    if (!labelEl) {
        labelEl = document.createElement("div");
        labelEl.className = "arcana-summary-label";
        labelEl.textContent = "보유 카드";
        summaryBox.prepend(labelEl);
    }
    labelEl.textContent = "보유 카드";

    let labelRow = summaryBox.querySelector(".arcana-summary-label-row");
    if (!labelRow) {
        labelRow = document.createElement("div");
        labelRow.className = "arcana-summary-label-row";
        summaryBox.insertBefore(labelRow, labelEl);
        labelRow.appendChild(labelEl);
    } else if (!labelRow.contains(labelEl)) {
        labelRow.prepend(labelEl);
    }

    let infoButton = summaryBox.querySelector(".arcana-info-btn");
    if (!infoButton) {
        infoButton = document.createElement("button");
        infoButton.type = "button";
        infoButton.className = "arcana-info-btn";
        infoButton.setAttribute("aria-label", ARCANA_INFO_MESSAGE);
        infoButton.textContent = "i";
        labelRow.appendChild(infoButton);
    }

    let equippedRow = summaryBox.querySelector(".arcana-equipped-row");
    if (!equippedRow) {
        equippedRow = document.createElement("div");
        equippedRow.className = "arcana-equipped-row";
        summaryBox.appendChild(equippedRow);
    }

    infoButton.hidden = !isMine;
    return { infoButton, equippedRow };
}

function updateSummaryUi({ countEl, equippedCount, maxEquippedSlots, cardsLength, isMine }) {
    if (countEl) {
        countEl.textContent = `${cardsLength}장`;
    }

    const { equippedRow } = ensureSummaryInfoUi({ countEl, isMine });
    if (equippedRow) {
        equippedRow.innerHTML = isMine ? buildEquippedStarsHtml(equippedCount, maxEquippedSlots) : "";
        equippedRow.classList.toggle("is-hidden", !isMine);
    }
}

export async function initCharacterArcanaPage() {
    const charId = getCurrentCharId();
    const titleEl = document.getElementById("arcanaTitle");
    const descEl = document.getElementById("arcanaDesc");
    let countEl = document.getElementById("arcanaCount");
    const createBtn = document.getElementById("arcanaCreateBtn");
    const createStatusEl = document.getElementById("arcanaCreateStatus");
    const listEl = document.getElementById("arcanaList");

    let currentIsMine = false;
    let availabilityTimer = null;
    let latestCards = [];
    let latestCharacterHead = null;
    let unbindInfoTip = null;

    function stopAvailabilityTimer() {
        if (!availabilityTimer) return;
        clearInterval(availabilityTimer);
        availabilityTimer = null;
    }

    function bindInfoButton() {
        const { infoButton } = ensureSummaryInfoUi({ countEl, isMine: currentIsMine });
        if (unbindInfoTip) {
            unbindInfoTip();
            unbindInfoTip = null;
        }
        if (infoButton && currentIsMine) {
            unbindInfoTip = bindTimedInfoTip(infoButton, ARCANA_INFO_MESSAGE, {
                duration: 2000
            });
        }
    }

    function applyCreateAvailability(availability = null) {
        stopAvailabilityTimer();

        const unavailable = availability && availability.state === "UNAVAILABLE";
        const nextResetAtMs = Number(availability?.nextResetAtMs) || 0;

        if (createBtn) {
            createBtn.disabled = !currentIsMine || unavailable;
            createBtn.textContent = "생성";
            createBtn.classList.toggle("is-unavailable", !!unavailable);
        }

        if (!createStatusEl) return;
        if (!currentIsMine || !unavailable || nextResetAtMs <= 0) {
            createStatusEl.textContent = "";
            return;
        }

        const render = () => {
            const remainMs = Math.max(0, nextResetAtMs - Date.now());
            createStatusEl.textContent = formatRemainingMs(remainMs);
        };

        render();
        availabilityTimer = window.setInterval(render, 1000);
    }

    function navigateToBattle(battleId = "") {
        if (!battleId) return;
        showPage("battle-log", {
            type: "push",
            battleId
        });
    }

    function bindCardEvents() {
        listEl?.querySelectorAll(".arcana-card[data-battle-id]").forEach((cardEl) => {
            const battleId = cardEl.getAttribute("data-battle-id") || "";
            if (!battleId) return;

            cardEl.addEventListener("click", (event) => {
                if (event.target.closest(".arcana-card-equip-btn")) return;
                navigateToBattle(battleId);
            });

            cardEl.addEventListener("keydown", (event) => {
                if (event.target.closest(".arcana-card-equip-btn")) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                navigateToBattle(battleId);
            });
        });

        listEl?.querySelectorAll(".arcana-card-equip-btn[data-card-id]").forEach((el) => {
            el.addEventListener("click", async (event) => {
                event.stopPropagation();

                const cardId = el.getAttribute("data-card-id") || "";
                const card = latestCards.find((item) => item.id === cardId);
                if (!card) return;
                await handleEquipClick(card);
            });
        });
    }

    async function refreshCharacterHead() {
        try {
            const res = await apiFetchCharacterById(charId);
            if (!res.ok) return;
            const data = await res.json();
            latestCharacterHead = data;
            currentIsMine = !!data.isMine;
            if (data.isMine) {
                syncMyCharacterArcanaCount(
                    data,
                    Number(data.arcanaEquippedCount) || 0,
                    Number(data.arcanaMaxEquippedSlots) || ARCANA_MAX_EQUIPPED
                );
            }
            if (titleEl) {
                titleEl.textContent = `${data.displayRawName || "캐릭터"}의 아르카나`;
            }
            if (descEl) {
                descEl.textContent = data.isMine
                    ? ""
                    : "이 아르카나는 현재 소유자만 확인할 수 있습니다.";
                descEl.classList.toggle("is-empty", data.isMine);
            }
            if (createBtn) {
                createBtn.disabled = !data.isMine;
            }

            bindInfoButton();
            updateSummaryUi({
                countEl,
                equippedCount: Number(data.arcanaEquippedCount) || 0,
                maxEquippedSlots: Number(data.arcanaMaxEquippedSlots) || ARCANA_MAX_EQUIPPED,
                cardsLength: latestCards.length,
                isMine: currentIsMine
            });
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
                latestCards = [];
                updateSummaryUi({
                    countEl,
                    equippedCount: 0,
                    maxEquippedSlots: ARCANA_MAX_EQUIPPED,
                    cardsLength: 0,
                    isMine: currentIsMine
                });
                return;
            }

            const json = await res.json();
            const cards = Array.isArray(json.cards) ? json.cards : [];
            latestCards = cards;

            const equippedCount = Number(json.equippedCount);
            const safeEquippedCount = Number.isFinite(equippedCount)
                ? Math.max(0, Math.floor(equippedCount))
                : cards.filter((card) => card.equipped).length;
            const maxEquippedSlots = Number(json.maxEquippedSlots) || ARCANA_MAX_EQUIPPED;

            if (latestCharacterHead?.isMine) {
                syncMyCharacterArcanaCount(latestCharacterHead, safeEquippedCount, maxEquippedSlots);
            }

            updateSummaryUi({
                countEl,
                equippedCount: safeEquippedCount,
                maxEquippedSlots,
                cardsLength: cards.length,
                isMine: currentIsMine
            });

            renderArcanaCards(listEl, cards);
            bindCardEvents();
        } catch (err) {
            console.error(err);
            latestCards = [];
            updateSummaryUi({
                countEl,
                equippedCount: 0,
                maxEquippedSlots: ARCANA_MAX_EQUIPPED,
                cardsLength: 0,
                isMine: currentIsMine
            });
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

    async function updateEquip(card, action, replaceCardId = "") {
        try {
            window.__startGlobalLoading?.();
            const res = await apiUpdateArcanaEquip({
                charId,
                cardId: card.id,
                action,
                replaceCardId
            });
            const json = await res.json().catch(() => ({ ok: false }));

            if (!res.ok || !json.ok) {
                await refreshCards({ showSkeleton: false });
                if (json.error === "ARCANA_CARD_EXPIRED") {
                    alert("30일이 지난 아르카나는 장착할 수 없습니다.");
                    return;
                }
                if (json.error === "ARCANA_EQUIP_SLOTS_FULL") {
                    alert("이미 3장이 장착되어 있습니다.");
                    return;
                }
                alert("아르카나 장착 상태를 변경하지 못했습니다.");
                return;
            }

            await refreshCards({ showSkeleton: false });
        } catch (err) {
            console.error(err);
            await refreshCards({ showSkeleton: false });
            alert("아르카나 장착 상태를 변경하지 못했습니다.");
        } finally {
            window.__stopGlobalLoading?.();
        }
    }

    async function openReplacePopup(targetCard) {
        const equippedCards = latestCards.filter((card) => card.equipped);
        if (equippedCards.length < ARCANA_MAX_EQUIPPED) {
            await updateEquip(targetCard, "equip");
            return;
        }

        openWrap(buildReplacePopupHtml(targetCard, equippedCards));
        document.querySelectorAll(".arcana-replace-btn[data-replace-card-id]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const replaceCardId = btn.getAttribute("data-replace-card-id") || "";
                closeWrapOverlay();
                await updateEquip(targetCard, "equip", replaceCardId);
            });
        });
    }

    async function handleEquipClick(card) {
        if (!currentIsMine) return;
        if (!card || !card.id) return;

        if (card.equipped) {
            await updateEquip(card, "unequip");
            return;
        }

        if (card.expired) {
            alert("30일이 지난 아르카나는 장착할 수 없습니다.");
            return;
        }

        const equippedCount = latestCards.filter((item) => item.equipped).length;
        if (equippedCount >= ARCANA_MAX_EQUIPPED) {
            await openReplacePopup(card);
            return;
        }

        await updateEquip(card, "equip");
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

    if (!charId) {
        renderArcanaEmptyState(listEl, "잘못된 접근입니다.");
        return;
    }

    sessionStorage.setItem("viewCharId", charId);

    ensureSummaryInfoUi({ countEl, isMine: false });

    if (titleEl) titleEl.textContent = "아르카나";
    if (descEl) {
        descEl.textContent = "전투의 여운을 카드로 새기는 중입니다.";
        descEl.classList.remove("is-empty");
    }
    if (countEl) countEl.textContent = "...";
    renderArcanaSkeleton(listEl, 6);

    createBtn?.addEventListener("click", openCreatePopup);
    window.addEventListener("pagehide", () => {
        stopAvailabilityTimer();
        if (unbindInfoTip) {
            unbindInfoTip();
            unbindInfoTip = null;
        }
    }, { once: true });

    await refreshCharacterHead();
    await refreshCards();
    await refreshCreateAvailability();
}
