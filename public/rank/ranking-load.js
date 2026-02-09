// ranking-load.js
import { initializeApp } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { CLIENT_CONFIG } from "/base/client.config.js";

/* ✅ 중앙 config에서 Firebase 설정 가져오기 */
const app = initializeApp(CLIENT_CONFIG.FIREBASE);
const db = getFirestore(app);

export async function loadRankingTop100() {
    try {
        const ref = doc(db, "rankingsCache", "top100");
        const snap = await getDoc(ref);

        if (!snap.exists()) return [];

        const data = snap.data();
        return Array.isArray(data.list) ? data.list : [];

    } catch (err) {
        console.error("랭킹 로드 실패", err);
        return [];
    }
}
