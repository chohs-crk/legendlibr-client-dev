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


// =====================================================
// ✅ 관리자 이메일 (본인 Google 계정)
// =====================================================
const ADMIN_EMAIL = "hhchocookierun1@gmail.com";


// ====== Firebase 초기화 ======
const firebaseConfig = {
    apiKey: "AIzaSyBOdqBFXQRg_jdRhYUjuusjOznqt6v7pkQ",
    authDomain: "legendlibr.firebaseapp.com",
    projectId: "legendlibr",
    storageBucket: "legendlibr.firebasestorage.app",
    messagingSenderId: "368559609215",
    appId: "1:368559609215:web:9434f0e39b82a927e5364a"
};


// =====================================================
// ✅ Firebase 초기화
// =====================================================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();


// =====================================================
// ✅ DOM
// =====================================================
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const btnInit = document.getElementById("btnInit");
const log = document.getElementById("log");


// =====================================================
// ✅ 로그인 / 로그아웃
// =====================================================
btnLogin.onclick = async () => {
    await signInWithPopup(auth, provider);
};

btnLogout.onclick = async () => {
    await signOut(auth);
};


// =====================================================
// ✅ 관리자 인증 체크
// =====================================================
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


// =====================================================
// ✅ 보스 데이터 정의
// =====================================================
const bossList = [

    {
        id: "B1",
        stage: "1단계",
        name: "침식의 포식자",
        desc: "부패에 잠식된 괴물…",
        hp: 1000,
        traits: ["중독", "지속 피해", "극독"],
        unlocked: true,
        isSeason: false,

        // ✅ 추가된 부분
        limit: 3,

        skills: [
            { name: "독니", class: "단일", pow: 25, desc: "단일 공격" },
            { name: "부식 브레스", class: "광역", pow: 15, desc: "전체 공격" },
            { name: "재생 조직", class: "회복", pow: 20, desc: "HP 회복" }
        ]
    },

    {
        id: "B2",
        stage: "2단계",
        name: "망각의 사도",
        desc: "기억을 집어삼키는 존재…",
        hp: 800,
        traits: ["혼란", "디버프", "마비"],
        unlocked: true,
        isSeason: false,

        // ✅ 추가된 부분
        limit: 4,

        skills: [
            { name: "기억 분쇄", class: "단일", pow: 30, desc: "강한 단일 공격" },
            { name: "정신 붕괴", class: "광역", pow: 18, desc: "파티 약화" }
        ]
    }

];



// =====================================================
// ✅ DB 업로드 실행
// =====================================================
btnInit.onclick = async () => {

    log.textContent += "📤 업로드 시작...\n";

    for (const boss of bossList) {

        await setDoc(doc(db, "raidBosses", boss.id), {
            ...boss,
            createdAt: serverTimestamp()
        });

        log.textContent += `✅ ${boss.name} 업로드 완료\n`;
    }

    log.textContent += "\n🎉 모든 보스 업로드 완료\n";
};
