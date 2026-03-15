import { resolveCharImage } from "/base/common/image-util.js";
import { openConfirm } from "/base/common/ui-confirm.js";
import { apiFetch } from "/base/api.js";
import {
    writeHomeCharactersCache,
    sanitizeHomeCharactersCache,
    removeCharacterFromHomeCache,
    clearHomeCharactersCache
} from "./home-cache.js";

let characters = [];

/* ===================================================
   FINAL PREVIEW CACHE
=================================================== */
const PENDING_FINAL_KEY = "pendingFinalPreview";

function readPendingFinalPreview() {
    const raw = sessionStorage.getItem(PENDING_FINAL_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;

        const rawName = String(parsed.rawName || "").trim();
        if (!rawName) return null;

        return {
            rawName,
            image: parsed.image || {
                type: "default",
                key: "base_01",
                url: ""
            },
            startedAt: Number(parsed.startedAt) || 0
        };
    } catch {
        return null;
    }
}

function writePendingFinalPreview(data) {
    if (!data?.rawName) return;
    sessionStorage.setItem(PENDING_FINAL_KEY, JSON.stringify({
        rawName: String(data.rawName).trim(),
        image: data.image || {
            type: "default",
            key: "base_01",
            url: ""
        },
        startedAt: Number(data.startedAt) || Date.now()
    }));
}

function clearPendingFinalPreview() {
    sessionStorage.removeItem(PENDING_FINAL_KEY);
}

/* ===================================================
   STORY CHECK POLLING STATE
=================================================== */
let storyCheckTimer = null;

/* ===================================================
   AUTH STATE
=================================================== */
function getHomeAuthState() {
    const user = window.__authUser || null;
    if (user) {
        return { isAuthed: true, user };
    }

    const uid = sessionStorage.getItem("uid");
    if (uid) {
        return {
            isAuthed: true,
            user: { uid }
        };
    }

    return {
        isAuthed: false,
        user: null
    };
}

/* ===================================================
   EVENT BIND
=================================================== */
function bindHomeEventsOnce() {
    const listEl = document.getElementById("charList");
    if (!listEl) return;

    if (listEl.dataset.createBound === "1") return;
    listEl.dataset.createBound = "1";

    listEl.addEventListener("click", (e) => {
        const btn = e.target.closest("#btnCreate");
        if (!btn) return;

        const { isAuthed } = getHomeAuthState();

        clearHomeCharactersCache();
        clearPendingFinalPreview();
        sessionStorage.removeItem("finalStartedAt");
        sessionStorage.setItem("homeCalled", "false");

        resetCreationFlow();

        if (!isAuthed) {
            sessionStorage.setItem("loginRedirect", "/create");
            window.location.href = "/base/login";
            return;
        }

        window.showPage?.("create", { type: "push" });
    });
}

/* ===================================================
   API
=================================================== */
async function getMyCharacters() {
    const res = await apiFetch("/base/characters");
    if (!res.ok) throw new Error("AUTH_FAIL");
    return res.json();
}

async function deleteCharacter(id) {
    const res = await apiFetch(`/base/characters?id=${id}`, {
        method: "DELETE"
    });
    if (!res.ok) throw new Error("DELETE_FAIL");
    return res.json();
}

async function getFinalProgress() {
    const pending = readPendingFinalPreview();

    let url = "/create/story-check";
    if (pending?.rawName) {
        url += `?rawName=${encodeURIComponent(pending.rawName)}`;
    }

    const res = await apiFetch(url);
    return res.json();
}

/* ===================================================
   UI
=================================================== */
function applyCharCountUI(charCount) {
    const count = Number(charCount ?? characters.length);
    const btnCreate = document.getElementById("btnCreate");
    if (!btnCreate) return;

    btnCreate.style.display = count >= 10 ? "none" : "";
}

function renderHomeSkeleton(count = 5) {
    const listEl = document.getElementById("charList");
    if (!listEl) return;

    const skeletonCards = Array.from({ length: count }, (_, index) => `
        <div class="char-card skeleton-card" aria-hidden="true" data-skeleton-index="${index}">
            <div class="char-thumb skeleton-thumb">
                <div class="skeleton-shimmer"></div>
            </div>
            <div class="home-card-overlay">
                <div class="home-skeleton-name skeleton-line"></div>
            </div>
        </div>
    `).join("");

    listEl.innerHTML = skeletonCards;
    listEl.style.opacity = "1";
}

function renderGuestHome() {
    characters = [];

    const listEl = document.getElementById("charList");
    if (!listEl) return;

    listEl.innerHTML = "";
    listEl.appendChild(createCreateCard());
    listEl.style.opacity = "1";

    applyCharCountUI(0);
}

function stopStoryCheckPolling() {
    if (storyCheckTimer) {
        clearTimeout(storyCheckTimer);
        storyCheckTimer = null;
    }
}

/* ===================================================
   서버 로드
=================================================== */
async function loadMyCharactersFromServer() {
    try {
        const data = await getMyCharacters();

        characters = (data.characters || []).map(c => ({
            ...c,
            isMine: true
        }));

        writeHomeCharactersCache(characters);
        sessionStorage.setItem("homeCalled", "true");

        applyCharCountUI(data.charCount);
        renderList();

    } catch (e) {
        console.error(e);
        alert("캐릭터 불러오기 실패");
    }
}

/* ===================================================
   리스트 렌더
=================================================== */
function renderList() {
    characters.sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return tb - ta;
    });

    const listEl = document.getElementById("charList");
    if (!listEl) return;

    listEl.innerHTML = "";

    const pending = readPendingFinalPreview();
    if (pending) {
        listEl.appendChild(createPendingFinalCard(pending));
    }

    characters.forEach((c) => {
        const card = document.createElement("div");
        card.className = "char-card";
        card.style.position = "relative";

        const nameDiv = document.createElement("div");
        nameDiv.className = "char-name";
        nameDiv.textContent = c.displayRawName || "(이름 없음)";

        const img = document.createElement("img");
        img.className = "char-thumb";
        img.src = resolveCharImage(c.image);

        card.appendChild(img);
        card.appendChild(nameDiv);

        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.type = "button";
        delBtn.textContent = "✕";

        delBtn.addEventListener("mouseenter", () => {
            delBtn.style.opacity = "1";
        });
        delBtn.addEventListener("mouseleave", () => {
            delBtn.style.opacity = "0.62";
        });

        card.appendChild(delBtn);

        delBtn.addEventListener("click", (e) => {
            e.stopPropagation();

            if (typeof openConfirm === "function") {
                openConfirm(`"${c.displayRawName}" 캐릭터를 삭제하시겠습니까?`, {
                    onConfirm: async () => {
                        try {
                            await deleteCharacter(c.id);

                            characters = characters.filter(ch => ch.id !== c.id);
                            removeCharacterFromHomeCache(c.id);

                            applyCharCountUI();
                            renderList();

                            openConfirm("삭제되었습니다.");

                        } catch (err) {
                            console.error("DELETE_FAIL:", err);
                            openConfirm("삭제에 실패했습니다.");
                        }
                    },
                    onCancel: () => { }
                });
            }
        });

        card.addEventListener("click", (e) => {
            if (e.target.classList.contains("delete-btn")) return;
            if (!c.id) return;

            sessionStorage.setItem("viewCharId", c.id);

            if (window.showPage) {
                window.showPage("character-view", {
                    type: "push",
                    charId: c.id
                });
            }
        });

        listEl.appendChild(card);
    });

    listEl.appendChild(createCreateCard());
    listEl.style.opacity = "1";
    applyCharCountUI();
}

function createCreateCard() {
    const button = document.createElement("button");
    button.className = "char-card create-card";
    button.id = "btnCreate";
    button.type = "button";
    button.setAttribute("aria-label", "생성하기");
    button.innerHTML = `
        <span class="create-card-plus" aria-hidden="true">+</span>
        <span class="create-card-text">생성하기</span>
    `;
    return button;
}

function createPendingFinalCard(pending) {
    const card = document.createElement("div");
    card.className = "char-card";
    card.id = "fake-final-card";
    card.style.position = "relative";
    card.style.opacity = "0.78";
    card.style.cursor = "pointer";

    const img = document.createElement("img");
    img.className = "char-thumb";
    img.src = "/images/base/base_01.png";

    const nameDiv = document.createElement("div");
    nameDiv.className = "char-name";
    nameDiv.textContent = `${pending.rawName} (생성 중...)`;

    card.appendChild(img);
    card.appendChild(nameDiv);

    card.addEventListener("click", async () => {
        try {
            const status = await getFinalProgress();

            if (status.ok && status.flow === "final") {
                location.href = "/creating";
                return;
            }

            if (status.ok && status.done && status.charId) {
                clearPendingFinalPreview();
                sessionStorage.removeItem("finalStartedAt");
                sessionStorage.setItem("viewCharId", status.charId);
                sessionStorage.setItem("homeCalled", "false");
                location.href = `/character/${status.charId}`;
                return;
            }

            if (!status.ok) {
                clearPendingFinalPreview();
                sessionStorage.removeItem("finalStartedAt");
                sessionStorage.setItem("homeCalled", "false");
                await loadMyCharactersFromServer();
                return;
            }

        } catch (err) {
            console.error("PENDING_FINAL_CLICK_ERROR:", err);
            alert("생성 상태를 확인하지 못했습니다.");
        }
    });

    return card;
}

/* ===================================================
   STORY CHECK POLLING
=================================================== */
function startStoryCheckPolling() {
    if (storyCheckTimer) return;

    const pending = readPendingFinalPreview();
    const startedAt = Number(sessionStorage.getItem("finalStartedAt"));

    if (!pending && !startedAt) return;

    const poll = async () => {
        const homePage = document.getElementById("page-home");
        if (!homePage?.classList.contains("active")) {
            storyCheckTimer = null;
            return;
        }

        try {
            const data = await getFinalProgress();

            if (data.ok && data.flow === "final") {
                writePendingFinalPreview({
                    rawName: data.rawName || pending?.rawName || "새 캐릭터",
                    image: {
                        type: "default",
                        key: "base_01",
                        url: ""
                    },
                    startedAt: startedAt || Date.now()
                });

                renderList();
            } else if (data.ok && data.done && data.charId) {
                clearPendingFinalPreview();
                sessionStorage.removeItem("finalStartedAt");
                sessionStorage.setItem("homeCalled", "false");
                clearHomeCharactersCache();

                await loadMyCharactersFromServer();
                return;
            } else if (!data.ok) {
                clearPendingFinalPreview();
                sessionStorage.removeItem("finalStartedAt");
                sessionStorage.setItem("homeCalled", "false");
                clearHomeCharactersCache();

                await loadMyCharactersFromServer();
                return;
            }
        } catch (err) {
            console.error("story-check error:", err);
        }

        storyCheckTimer = setTimeout(poll, 3000);
    };

    poll();
}

/* ===================================================
   INIT
=================================================== */
export async function initHomePage() {
    bindHomeEventsOnce();

    const { isAuthed } = getHomeAuthState();

    if (!isAuthed) {
        stopStoryCheckPolling();
        clearHomeCharactersCache();
        clearPendingFinalPreview();
        sessionStorage.removeItem("finalStartedAt");
        sessionStorage.setItem("homeCalled", "false");
        renderGuestHome();
        return;
    }

    startStoryCheckPolling();

    const homeCalled = sessionStorage.getItem("homeCalled");

    if (homeCalled === "true") {
        const cached = sanitizeHomeCharactersCache();

        characters = cached;
        renderList();
        return;
    }

    renderHomeSkeleton(5);
    await loadMyCharactersFromServer();
}

/* ===================================================
   생성 플로우 초기화
=================================================== */
function resetCreationFlow() {
    const keys = [
        "origin",
        "originDesc",
        "displayNameRaw",
        "realName",
        "prompt1",
        "prologue",
        "story_segments",
        "choice_text",
        "choice_index",
        "choice_text_2",
        "choice_index_2",
        "choice_text_3",
        "choice_index_3",
        "finalStory"
    ];

    keys.forEach((k) => sessionStorage.removeItem(k));
}