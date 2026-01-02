// =======================
// ✅ raid-select.js (프론트 최종 서버연동 버전)
// =======================


// ✅ Firebase 완전 제거 (세션 쿠키 기반)
const bossId = new URLSearchParams(window.location.search).get("bossId");



// =======================
// ✅ DOM
// =======================
const bossName = document.getElementById("bossName");
const bossStage = document.getElementById("bossStage");
const bossDesc = document.getElementById("bossDesc");
const limitText = document.getElementById("limitText");

const charList = document.getElementById("slotContainer");
const btnStart = document.getElementById("btnStartRaid");

// =======================
// ✅ 상태
// =======================
let raidData = null;        // 서버에서 받은 raid 요약
let allCharacters = [];    // ✅ 서버에서 받은 캐릭터 (이름 + 스킬 name/longDesc만 있음)
let slots = [];            // 슬롯에 들어간 charId
let skillSelections = {}; // { charId: [0,1,2] }
let activeSlotIndex = null;
let currentLimit = 3;   // ✅ 보스 기준 캐릭터 제한 수

// =======================
// ✅ 서버 API
// =======================
const API = "https://ai-proxy2.vercel.app/api/raid/raid-back";

// =======================
// ✅ 1️⃣ 레이드 정보 + 보스 정보 불러오기
// =======================


// =======================
// ✅ 2️⃣ 내 캐릭터 + 스킬(이름/longDesc만) 불러오기
// =======================
async function loadMyCharacters() {
    const res = await fetch(API, {
        method: "POST",
        credentials: "include",   // ✅ 세션 인증
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            action: "getMyRaidCharacters",
            bossId: bossId    // 대문자 I 사용

        })
    });


    const data = await res.json();
    
    currentLimit = data.limit ?? 3;
    limitText.textContent = `출전 인원: ${currentLimit}명`;

    if (!data.ok) {
        alert("캐릭터를 불러올 수 없습니다.");
        return;
    }

    allCharacters = data.characters || [];
    initSlots(currentLimit);

    renderSlots();
}

// =======================
// ✅ 3️⃣ 슬롯 초기화
// =======================
function initSlots(limit) {

    // 1) 기존 슬롯이 있었다면 유지하려고 시도
    const oldSlots = slots.slice();

    slots = [];

    // 2) limit만큼 슬롯 생성하되 기존값 유지
    for (let i = 0; i < limit; i++) {
        slots[i] = oldSlots[i] ?? allCharacters[i]?.id ?? null;
    }

    // 3) 슬롯 수가 줄었을 경우 잘린 캐릭터의 스킬 선택 제거
    if (oldSlots.length > limit) {
        for (let i = limit; i < oldSlots.length; i++) {
            const removedChar = oldSlots[i];
            if (removedChar && skillSelections[removedChar]) {
                delete skillSelections[removedChar];
            }
        }
    }
}


// =======================
// ✅ 4️⃣ 슬롯 렌더
// =======================
function renderSlots() {
    charList.innerHTML = "";

    slots.forEach((charId, idx) => {
        const char = allCharacters.find(c => c.id === charId);

        const div = document.createElement("div");
        div.className = "char-card";

        div.innerHTML = `
      <div class="char-name">${char ? char.name : "비어 있음"}</div>
      <div class="char-actions">
        <button class="btn-change">변경</button>
        ${char ? `<button class="btn-skill">스킬</button>` : ""}
      </div>
    `;

        div.querySelector(".btn-change").onclick = () => openChangeDialog(idx);

        const btnSkill = div.querySelector(".btn-skill");
        if (btnSkill) btnSkill.onclick = () => openSkillDialog(char.id);

        charList.appendChild(div);
    });

    checkReady();
}

// =======================
// ✅ 5️⃣ 캐릭터 변경 다이얼로그
// =======================
function openChangeDialog(slotIndex) {
    activeSlotIndex = slotIndex;

    const dlg = document.getElementById("skillDialog");
    const list = document.getElementById("skillList");
    const title = document.getElementById("skillCharName");

    title.textContent = "캐릭터 선택";
    list.innerHTML = "";

    allCharacters.forEach(ch => {
        const isUsed = slots.includes(ch.id);
        const isThis = slots[slotIndex] === ch.id;

        const div = document.createElement("div");
        div.textContent = ch.name;

        if (isUsed && !isThis) {
            div.style.opacity = "0.3";
            div.textContent += " (사용중)";
        } else {
            div.onclick = () => {
                slots[slotIndex] = ch.id;
                dlg.close();
                renderSlots();
            };
        }

        list.appendChild(div);
    });

    dlg.showModal();
}

// =======================
// ✅ 6️⃣ 스킬 선택 다이얼로그 (name + longDesc만 사용)
// =======================
function openSkillDialog(charId) {
    const char = allCharacters.find(c => c.id === charId);

    const dlg = document.getElementById("skillDialog");
    const list = document.getElementById("skillList");
    const title = document.getElementById("skillCharName");

    title.textContent = `${char.name} - 스킬 선택`;
    list.innerHTML = "";

    let chosen = skillSelections[charId];
    if (!chosen || chosen.length === 0) {
        chosen = [0, 1, 2];
        skillSelections[charId] = chosen;
    }

    const skills = char.skills || [];

    skills.forEach((s, idx) => {
        const div = document.createElement("div");
        div.className = "skill-item";

        div.innerHTML = `
      <label style="display:flex; gap:6px; align-items:center;">
        <input type="checkbox" ${chosen.includes(idx) ? "checked" : ""}>
        <strong>${s.name}</strong>
      </label>
      <div class="skill-desc">${s.longDesc || ""}</div>
    `;

        const input = div.querySelector("input");
        input.onchange = () => {
            if (input.checked) {
                if (chosen.length >= 3) {
                    input.checked = false;
                    alert("스킬은 3개까지만 선택 가능합니다.");
                    return;
                }
                chosen.push(idx);
            } else {
                chosen = chosen.filter(v => v !== idx);
            }
            skillSelections[charId] = chosen;
            checkReady();
        };

        list.appendChild(div);
    });

    dlg.showModal();
}

// =======================
// ✅ 7️⃣ 시작 가능 여부 체크
// =======================
function checkReady() {
    if (slots.some(v => !v)) {
        btnStart.disabled = true;
        return;
    }
    btnStart.disabled = false;
}

// =======================
// ✅ 8️⃣ 레이드 시작 (서버에 팀 정보만 전달)
// =======================
btnStart.onclick = async () => {
    const teamData = slots.map(charId => ({
        charId,
        selectedSkills: skillSelections[charId] || [0, 1, 2]
    }));

    await fetch(API, {
        method: "POST",
        credentials: "include",   // ✅ 세션 인증
        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            action: "setTempTeam",   // ✅ raid-back에 임시 저장
            bossId,
            team: teamData
        })
     });

     location.href = `/raid/raid-load.html?bossId=${bossId}`;

};

// =======================
// ✅ 9️⃣ 최초 진입
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

        // ✅ 1) 이 보스의 상태 조회
        const st = await fetch(API, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "checkMyBossRaidStatus",
                bossId
            })
        });

        const data = await st.json();

        if (data.status === "100") {
            location.href = `/raid/raid-load.html?raidId=${data.raidId}`;
            return;
        }

        if (data.status === "110") {
            await fetch(API, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    action: "forceFinishRaid",
                    raidId: data.raidId
                })
            });

            alert("이전에 완료되지 않은 배틀은 패배로 처리되었습니다.");
        }

        await loadMyCharacters();

    } catch (e) {
        alert("로그인 확인 실패");
        location.href = "/base/index.html";
    }
})();


  
