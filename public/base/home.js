import { requireAuthOrRedirect } from "./auth.js";
import { resolveCharImage } from "/base/common/image-util.js";
import { openConfirm } from "/base/common/ui-confirm.js";
import { apiFetch } from "/base/api.js";
const btnCreate = document.getElementById("btnCreate");
let characters = [];

// ==== 생성 버튼 → 모달 열기 ====
btnCreate?.addEventListener("click", () => {

    /* =========================
       🔥 홈 캐시 강제 초기화
    ========================= */
    sessionStorage.removeItem("homeCharacters");
    sessionStorage.setItem("homeCalled", "false");

    /* =========================
       🔥 생성 플로우 초기화
    ========================= */
    resetCreationFlow();

    showPage("create");
});

// home.js 전용 API로 이전
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
function applyCharCountUI(charCount) {
    const count = Number(charCount ?? characters.length);
    const btnCreate = document.getElementById("btnCreate");
    if (!btnCreate) return;

    btnCreate.style.display = count >= 10 ? "none" : "";
}

async function loadMyCharactersFromServer() {
    try {
        const data = await getMyCharacters();


        characters = data.characters || [];

        // ✅ 세션 캐시 저장
        sessionStorage.setItem(
            "homeCharacters",
            JSON.stringify(characters)
        );
        sessionStorage.setItem("homeCalled", "true");
        /* =========================
   🔥 battleCharId 삭제 대응
========================= */
        const battleCharId = sessionStorage.getItem("battleCharId");

        if (battleCharId === characters.id) {
            sessionStorage.removeItem("battleCharId");

            if (characters.length > 0) {
                sessionStorage.setItem(
                    "battleCharId",
                    characters[0].id // ✅ 0번 캐릭터로 자동 교체
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


// ==== 리스트 렌더 ====
function renderList() {
    // SPA 구조에서는 페이지 전환 시 요소가 새로 그려질 수 있으므로 다시 참조합니다.
    const listEl = document.getElementById("charList");
    if (!listEl) return;
    listEl.innerHTML = '';

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

        // 🔹 삭제 버튼 생성
        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.textContent = "✕";

        // 인라인 스타일 유지
        Object.assign(delBtn.style, {
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: '14px',
            cursor: 'pointer',
            opacity: '0.6',
            transition: 'opacity 0.2s'
        });

        delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
        delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.6');

        card.appendChild(delBtn);

        // 🗑️ 삭제 로직
        delBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // 카드 클릭 이벤트 전파 방지

            // 1️⃣ 삭제 확인 모달 (index.html에 추가한 #confirmOverlay 사용)
            if (typeof openConfirm === "function") {
                openConfirm(`"${c.displayRawName}" 캐릭터를 삭제하시겠습니까?`, {
                    onConfirm: async () => {
                        try {
                            await deleteCharacter(c.id);


                            // ✅ 메모리 상태 갱신
                            characters = characters.filter(ch => ch.id !== c.id);

                            // ✅ 세션 캐시 갱신
                            sessionStorage.setItem(
                                "homeCharacters",
                                JSON.stringify(characters)
                            );

                            // ✅ UI 즉시 반영
                            applyCharCountUI();
                            renderList();

                            openConfirm("삭제되었습니다.");


                        } catch (err) {
                            console.error("DELETE_FAIL:", err);
                            openConfirm("삭제에 실패했습니다.");
                        }
                    },

                    // ✅ 취소 버튼 추가 (아무 동작 없음)
                    onCancel: () => {
                        // 닫기만 하면 됨
                    }
                });

            }
        });

        // 🔍 카드 클릭 시 상세 페이지 이동
        card.addEventListener("click", (e) => {
            if (e.target.classList.contains('delete-btn')) return;
            if (!c.id) return;

            // SPA용 데이터 전달 및 페이지 전환
            sessionStorage.setItem("viewCharId", c.id);
            if (window.showPage) {
                window.showPage("character-view");
            }
        });

        listEl.appendChild(card);
    });

    
}


export async function initHomePage() {

    const me = await requireAuthOrRedirect();

    const generating = sessionStorage.getItem("charactergenerating");

    // 🔥 생성 중이면 캐시 무시하고 서버 체크 우선
    if (generating === "T") {
        const finished = await checkFinalSessionStatus();

        if (finished) {
            sessionStorage.setItem("charactergenerating", "F");
            sessionStorage.setItem("homeCalled", "false");
            location.reload();
            return;
        }

        // 🔥 아직 생성 중이면 캐시 사용하지 않음
        sessionStorage.setItem("homeCalled", "false");
    }

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

async function checkFinalSessionStatus() {
    try {
        const res = await apiFetch("/create/story-check");

        if (!res.ok) return false;

        const data = await res.json();

        // 🔥 세션이 없으면 생성 완료 or 종료 상태
        if (!data.ok) {
            return true;
        }

        // final 흐름이 아니면 이미 종료
        if (data.flow !== "final") {
            return true;
        }

        // final인데 called=true && resed=true 면 완료
        if (data.called && data.resed) {
            return true;
        }

        return false;

    } catch (err) {
        console.error("FINAL CHECK ERROR:", err);
        return false;
    }
}


// 🔽 생성 플로우 시작 시 초기화용 함수 추가
function resetCreationFlow() {
  const keys = [
    // 기원·이름·프롬프트
    'origin',
    'originDesc',
    'displayNameRaw',
    'realName',
    'prompt1',

    // 서막·장면·선택지
    'prologue',
    'story_segments',
    'choice_text',
    'choice_index',
    'choice_text_2',
    'choice_index_2',
    'choice_text_3',
    'choice_index_3',

    // 최종 스토리/기타
    'finalStory'
  ];

  keys.forEach((k) => sessionStorage.removeItem(k));
}
