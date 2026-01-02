// Firebase CDN (ESM)
import { initializeApp } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import { getFirestore, doc, getDoc } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* 🔥 Firebase 설정 (기존 Script1.js에 있던 것 그대로 복사) */
const firebaseConfig = {
    apiKey: "AIzaSyBOdqBFXQRg_jdRhYUjuusjOznqt6v7pkQ",
    authDomain: "legendlibr.firebaseapp.com",
    projectId: "legendlibr",
    storageBucket: "legendlibr.firebasestorage.app",
    messagingSenderId: "368559609215",
    appId: "1:368559609215:web:9434f0e39b82a927e5364a",
    measurementId: "G-N896X6SGD4"
};

/* 초기화 */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * 랭킹 로드
 * - 서버에서 계산된 top100만 읽음
 */
export async function loadRankingTop100() {
    try {
        const ref = doc(db, "rankingsCache", "top100");
        const snap = await getDoc(ref);

        if (!snap.exists()) {
            console.warn("랭킹 캐시 없음");
            return [];
        }

        const data = snap.data();
        if (!Array.isArray(data.list)) {
            console.warn("랭킹 데이터 형식 오류");
            return [];
        }

        return data.list;

    } catch (err) {
        console.error("랭킹 로드 실패", err);
        return [];
    }
}
