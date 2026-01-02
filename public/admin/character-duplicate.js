import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
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
// ✅ 관리자 이메일
// =====================================================
const ADMIN_EMAIL = "hhchocookierun1@gmail.com";

// =====================================================
// Firebase 설정 (기존 그대로)
// =====================================================
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

// =====================================================
// DOM
// =====================================================
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const btnDuplicate = document.getElementById("btnDuplicate");
const sourceInput = document.getElementById("sourceCharId");
const newInput = document.getElementById("newCharId");
const log = document.getElementById("log");

// =====================================================
// 로그인
// =====================================================
btnLogin.onclick = async () => {
    await signInWithPopup(auth, provider);
};

btnLogout.onclick = async () => {
    await signOut(auth);
};

// =====================================================
// 관리자 체크
// =====================================================
onAuthStateChanged(auth, (user) => {
    if (!user) {
        btnDuplicate.disabled = true;
        log.textContent = "❌ 로그인 필요\n";
        return;
    }

    if (user.email !== ADMIN_EMAIL) {
        btnDuplicate.disabled = true;
        log.textContent = "❌ 관리자 권한 없음\n";
        return;
    }

    btnDuplicate.disabled = false;
    log.textContent = `✅ 관리자 로그인: ${user.email}\n`;
});

// =====================================================
// 🔥 캐릭터 복사 로직
// =====================================================
btnDuplicate.onclick = async () => {

    const sourceId = sourceInput.value.trim();
    if (!sourceId) {
        alert("원본 캐릭터 ID를 입력하세요");
        return;
    }

    const newId =
        newInput.value.trim() ||
        `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    log.textContent += `📥 원본 로드: ${sourceId}\n`;

    const sourceRef = doc(db, "characters", sourceId);
    const snap = await getDoc(sourceRef);

    if (!snap.exists()) {
        log.textContent += "❌ 원본 캐릭터 없음\n";
        return;
    }

    const data = snap.data();

    // 🔥 핵심: ID만 바꾸고 내용은 그대로
    await setDoc(doc(db, "characters", newId), {
        ...data,
        createdAt: serverTimestamp()
    });

    log.textContent += `✅ 복사 완료 → ${newId}\n`;
};
