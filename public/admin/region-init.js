import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
    getFirestore,
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

const ADMIN_EMAIL = "hhchocookierun1@gmail.com";

const firebaseConfig = {
    apiKey: "AIzaSyBOdqBFXQRg_jdRhYUjuusjOznqt6v7pkQ",
    authDomain: "legendlibr.firebaseapp.com",
    projectId: "legendlibr",
    storageBucket: "legendlibr.firebasestorage.app",
    messagingSenderId: "368559609215",
    appId: "1:368559609215:web:9434f0e39b82a927e5364a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const btnInit = document.getElementById("btnInit");
const log = document.getElementById("log");

btnLogin.onclick = async () => { await signInWithPopup(auth, provider); };
btnLogout.onclick = async () => { await signOut(auth); };

onAuthStateChanged(auth, (user) => {
    if (!user) {
        btnInit.disabled = true;
        log.textContent = "❌ 로그인 필요\n";
        return;
    }
    if (user.email !== ADMIN_EMAIL) {
        btnInit.disabled = true;
        log.textContent = "❌ 관리자 권한 없음\n";
        return;
    }
    btnInit.disabled = false;
    log.textContent = `✅ 관리자 로그인: ${user.email}\n`;
});

// =============================================
// 🔥 기본 Region 목록 정의 (원하는 만큼 추가 가능)
// =============================================
const regionDefaults = [
    {
        id: "IRON_CROWN_DEFAULT",
        originId: "IRON_CROWN",
        name: "황철전로",
        detail: `전쟁과 절망이 이어지는 대륙 북부 중심지로, 거대한 제련소와 돌로 지어진 병영이 끝없이 늘어서 있다. 이곳은 오래전부터 무기 생산과 용병 모집으로 번영했으며, 도시 전체가 강철 냄새와 연기에 잠겨 있다. 계급과 전통은 힘과 실리를 기준으로 결정되며, 귀족과 장인의 경쟁이 끊이지 않는다. 전사들은 명예보다 생존을 우선시하고, 약자는 보호받지 못한다. 전쟁 준비는 일상이자 경제 기반이 되어 백성들 또한 피와 땀으로 무쇠 같은 인내를 기른다.`,
        score: 10
    },
    {
        id: "CHAOS_MIDLANDS_DEFAULT",
        originId: "CHAOS_MIDLANDS",
        name: "검령곡도",
        detail: `수많은 문파와 가문이 흐르는 계곡 지대에 자리한 곳으로, 좁은 오솔길과 절벽 길을 따라 비급과 유물을 둘러싼 분쟁이 끊이지 않는다. 세력 간 동맹과 배신은 하루에도 여러 번 뒤바뀌며, 객잔에서는 소문과 모략이 칼날처럼 오간다. 전통적인 의리도 존재하지만 언제든 실리에 밀려 퇴색할 수 있고, 원한은 대를 이어 이어진다. 수련자들은 내공을 쌓기 위해 산길을 오르내리며, 강자만이 이름을 남기고 약자는 흔적 없이 사라진다. 이 지역에서 평온은 희귀한 사치다.`,
        score: 10
    },
    {
        id: "AURELION_DEFAULT",
        originId: "AURELION",
        name: "광휘의계단",
        detail: `하늘로 이어지는 계단식 도시로, 백색 대리석과 성광으로 이루어진 건축물이 반짝인다. 시민들은 태어날 때부터 역할과 계급을 부여받으며, 성직자들은 질서와 규율을 바탕으로 사회를 유지한다. 겉으로는 자비와 정의가 넘치지만, 완벽함을 위해 엄격한 심사가 이뤄진다. 작은 혼란조차 허용되지 않으며, 규율을 어기는 자는 정화 절차를 거친다. 빛의 축복은 명예이자 부담이 되고, 책임은 무겁게 뒤따른다. 도시 곳곳에는 경건한 침묵과 경계가 함께 흐른다.`,
        score: 10
    },
    {
        id: "NELGARD_DEFAULT",
        originId: "NELGARD",
        name: "지옥계약성",
        detail: `끝없는 불길과 검붉은 하늘 아래 세워진 악마의 성채 도시로, 모든 관계는 계약과 조건을 전제로 이루어진다. 주민들의 힘과 지위는 계약을 통해 증명되며, 배신은 일상적인 도구로 받아들여진다. 거리를 가로지르는 용암 강은 통행과 방어 기능을 담당하고, 첨탑들 사이에서는 비명과 속삭임이 뒤섞인다. 이곳에서 약자는 살아남기 위해 끝없이 새로운 협상을 시도하고, 강자는 상대를 굴복시켜 영향력을 확장한다. 구원과 자비는 꿈일 뿐이며, 생존이 곧 목적이다.`,
        score: 10
    },
    {
        id: "NEO_ARCADIA_DEFAULT",
        originId: "NEO_ARCADIA",
        name: "네온하층가",
        detail: `초거대 빌딩이 하늘을 가리는 도시의 하층부로, 홀로그램 광고와 네온 불빛이 끊임없이 반사되어 혼란을 만든다. 초대기업의 감시는 일상이며, 정보와 데이터는 화폐보다 큰 가치를 가진다. 빈민층과 개조된 인간들이 공존하고, 불법 시장에서는 사이버 장비와 신체 개조 부품이 거래된다. 상층부의 호화로움과는 대조적으로 이곳은 열악한 환경과 독성이 있는 공기로 가득하다. 그러나 혁신과 반란의 불씨는 끊이지 않고, 새로운 질서를 꿈꾸는 이들이 잠복한다.`,
        score: 10
    },
    {
        id: "SYLVARIA_DEFAULT",
        originId: "SYLVARIA",
        name: "생명의울림숲",
        detail: `거대한 고목들이 천장을 이루는 숲 속 도시로, 엘프와 정령들이 자연의 균형을 유지한다. 외부인의 발걸음은 나무와 숲이 직접 판단하며, 마법의 문양과 빛은 길을 비추기도 하고 위협을 감지하기도 한다. 자비로움과 잔혹함은 한 벌의 잎처럼 공존하고, 균형을 깨뜨리는 존재는 조용히 제거된다. 오래된 전승과 노래가 생명력을 이어주며, 숲의 결정은 절대적이다. 숲은 숨 쉬듯 성장하며, 침입자는 시험을 견뎌야 한다.`,
        score: 10
    },
    {
        id: "DEEP_FORGE_DEFAULT",
        originId: "DEEP_FORGE",
        name: "화심제련소",
        detail: `불타는 화산의 중심부 깊숙이 자리한 제련 도시로, 드워프 장인들은 용암을 활용해 금속과 방어구를 제작한다. 거대한 대장간들은 끊임없이 타오르며, 금속 냄새와 뜨거운 바람이 공기를 뒤덮는다. 외부인은 신뢰를 얻기 어렵고, 전통과 기술에 대한 자부심은 절대적이다. 채굴과 제련은 생존과 번영의 기초가 되며, 장인들은 빛과 불꽃 속에서 자신의 기술을 끊임없이 연마한다. 단단한 의지와 인내만이 이곳에서 살아남게 한다.`,
        score: 10
    }
];



btnInit.onclick = async () => {
    log.textContent += "📤 Region 업로드 시작...\n";

    for (const region of regionDefaults) {
        await setDoc(doc(db, "regionsDefault", region.id), {
            id: region.id,
            originId: region.originId,
            name: region.name,
            detail: region.detail,
            score: 10,
            createdAt: serverTimestamp()
        });


        log.textContent += `✅ ${region.name} 업로드 완료\n`;
    }

    log.textContent += "\n🎉 모든 기본 region 업로드 완료!";
};
