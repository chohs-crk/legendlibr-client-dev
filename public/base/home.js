import { requireAuthOrRedirect } from "./auth.js";
import { resolveCharImage } from "/base/common/image-util.js";
import { openConfirm } from "/base/common/ui-confirm.js";
let currentUid = null;
let characters = [];



function smoothNavigate(url) {
    document.body.classList.add("page-fade");
    document.body.classList.add("hide");

    setTimeout(() => {
        window.location.href = url;
    }, 300);
}




const MAX_CHARACTERS = 5; // 계정당 최대 생성 가능 수




// ==== DOM 요소 ====
const $ = (sel) => document.querySelector(sel);
const listEl = $("#charList");




const btnCreate = document.querySelector("#btnCreate");



// 미로그인 기본 상태: 생성 비활성
if (btnCreate) btnCreate.disabled = true;


// ==== 생성 버튼 → 모달 열기 ====
btnCreate?.addEventListener("click", () => {
     resetCreationFlow();
    showPage("create");


});


async function loadMyCharactersFromServer() {
    try {
        const data = await API.getMyCharacters();
        characters = data.characters || [];
        renderList();
    } catch (e) {
        alert("캐릭터 불러오기 실패");
    }
}


// ==== 리스트 렌더 ====
function renderList() {
    // SPA 구조에서는 페이지 전환 시 요소가 새로 그려질 수 있으므로 다시 참조합니다.
    const listEl = document.getElementById("charList");
    const btnCreate = document.getElementById("btnCreate");

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
                            // 서버 삭제 (window.API 참조)
                            await window.API.deleteCharacter(c.id);

                            // UI 업데이트
                            card.remove();
                            characters = characters.filter(ch => ch.id !== c.id);

                            // 생성 버튼 복구 체크
                            if (btnCreate && characters.length < MAX_CHARACTERS) {
                                btnCreate.style.display = "";
                            }

                            // 2️⃣ 삭제 완료 알림
                            openConfirm("삭제되었습니다.");

                        } catch (err) {
                            console.error("DELETE_FAIL:", err);
                            openConfirm("삭제에 실패했습니다.");
                        }
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

    // 생성 버튼 제한 처리
    if (btnCreate) {
        if (characters.length >= MAX_CHARACTERS) {
            btnCreate.style.display = "none";
        } else {
            btnCreate.style.display = "";
        }
    }
}

















export async function initHomePage() {
    const me = await requireAuthOrRedirect();
    currentUid = me.uid;
    btnCreate.disabled = false;
    await loadMyCharactersFromServer();
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
