import { requireAuthOrRedirect } from "./auth.js";
import { resolveCharImage } from "/base/common/image-util.js";
import { openConfirm } from "/base/common/ui-confirm.js";
import { apiFetch } from "/base/api.js";

const btnCreate = document.getElementById("btnCreate");

let characters = [];

/* ===================================================
   🔥 STORY CHECK POLLING STATE
=================================================== */
let storyCheckTimer = null;
let storyCheckInterval = 10000; // 기본 10초
let wasFinalFlow = false;

/* ===================================================
   생성 버튼
=================================================== */
btnCreate?.addEventListener("click", () => {

    sessionStorage.removeItem("homeCharacters");
    sessionStorage.setItem("homeCalled", "false");

    resetCreationFlow();

    showPage("create");
});

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

/* ===================================================
   UI
=================================================== */
function applyCharCountUI(charCount) {
    const count = Number(charCount ?? characters.length);
    const btnCreate = document.getElementById("btnCreate");
    if (!btnCreate) return;

    btnCreate.style.display = count >= 10 ? "none" : "";
}

/* ===================================================
   서버 로드
=================================================== */
async function loadMyCharactersFromServer() {
    try {
        const data = await getMyCharacters();

        characters = data.characters || [];

        sessionStorage.setItem(
            "homeCharacters",
            JSON.stringify(characters)
        );
        sessionStorage.setItem("homeCalled", "true");

        const battleCharId = sessionStorage.getItem("battleCharId");

        if (battleCharId === characters.id) {
            sessionStorage.removeItem("battleCharId");

            if (characters.length > 0) {
                sessionStorage.setItem(
                    "battleCharId",
                    characters[0].id
                );
            }
        }

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

    const listEl = document.getElementById("charList");
    if (!listEl) return;

    listEl.innerHTML = "";

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
        delBtn.textContent = "✕";

        Object.assign(delBtn.style, {
            position: "absolute",
            top: "6px",
            right: "6px",
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: "14px",
            cursor: "pointer",
            opacity: "0.6",
            transition: "opacity 0.2s"
        });

        delBtn.addEventListener("mouseenter", () => delBtn.style.opacity = "1");
        delBtn.addEventListener("mouseleave", () => delBtn.style.opacity = "0.6");

        card.appendChild(delBtn);

        delBtn.addEventListener("click", (e) => {
            e.stopPropagation();

            if (typeof openConfirm === "function") {
                openConfirm(`"${c.displayRawName}" 캐릭터를 삭제하시겠습니까?`, {
                    onConfirm: async () => {
                        try {
                            await deleteCharacter(c.id);

                            characters = characters.filter(ch => ch.id !== c.id);

                            sessionStorage.setItem(
                                "homeCharacters",
                                JSON.stringify(characters)
                            );

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
                window.showPage("character-view");
            }
        });

        listEl.appendChild(card);
    });
}

/* ===================================================
   FINAL 가짜 카드
=================================================== */
function injectFakeFinalCard(introText) {

    const listEl = document.getElementById("charList");
    if (!listEl) return;

    if (document.getElementById("fake-final-card")) return;

    const name = extractNameFromIntro(introText);

    const card = document.createElement("div");
    card.className = "char-card";
    card.id = "fake-final-card";
    card.style.opacity = "0.6";
    card.style.pointerEvents = "none";

    const img = document.createElement("img");
    img.className = "char-thumb";
    img.src = "/images/base/base_01.png";

    const nameDiv = document.createElement("div");
    nameDiv.className = "char-name";
    nameDiv.textContent = name + " (생성 중...)";

    card.appendChild(img);
    card.appendChild(nameDiv);

    listEl.prepend(card);
}

function extractNameFromIntro(text) {
    if (!text) return "새 캐릭터";
    const match = text.match(/“(.+?)”|\"(.+?)\"/);
    if (match) return match[1] || match[2];
    return text.split(" ")[0] || "새 캐릭터";
}

/* ===================================================
   STORY CHECK POLLING
=================================================== */
function startStoryCheckPolling() {

    if (storyCheckTimer) return;

    const poll = async () => {

        const homePage = document.getElementById("page-home");
        if (!homePage?.classList.contains("active")) {
            storyCheckTimer = null;
            return;
        }

        try {
            const res = await apiFetch("/create/story-check");
            if (res.ok) {
                const data = await res.json();

                if (data.ok && data.flow === "final") {

                    if (!wasFinalFlow) {
                        wasFinalFlow = true;
                        storyCheckInterval = 3000; // final 단계면 더 빠르게
                    }

                    injectFakeFinalCard(data.intro);
                }

                if (wasFinalFlow && !data.ok) {
                    location.reload();
                    return;
                }
            }

        } catch (err) {
            console.error("story-check error:", err);
        }

        // 🔥 실행 끝나고 10초 후 다시 실행
        storyCheckTimer = setTimeout(poll, storyCheckInterval);
    };

    // 🔥 즉시 1회 실행
    poll();
}


/* ===================================================
   INIT
=================================================== */
export async function initHomePage() {

    await requireAuthOrRedirect();

    startStoryCheckPolling();

    const homeCalled = sessionStorage.getItem("homeCalled");

    if (homeCalled === "true") {
        const cached = sessionStorage.getItem("homeCharacters");
        if (cached) {
            characters = JSON.parse(cached);
            applyCharCountUI();
            renderList();
            return;
        }
    }

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
