// ranking-load.js
import { initializeApp } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { CLIENT_CONFIG } from "/base/client.config.js";

/* ✅ 중앙 config에서 Firebase 설정 가져오기 */
const app = initializeApp(CLIENT_CONFIG.FIREBASE);
const db = getFirestore(app);

const CACHE_KEY = "rankingTop100Cache";
const CACHE_TTL = 305000; // 5분 5초

export async function loadRankingTop100() {
    try {

        // 1️⃣ 세션 캐시 확인
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);

        if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);

            if (
                cached.updatedAt &&
                Date.now() - cached.updatedAt < CACHE_TTL &&
                Array.isArray(cached.list)
            ) {
                return cached.list;
            }
        }

        // 2️⃣ Firestore에서 로드
        const ref = doc(db, "rankingsCache", "top100");
        const snap = await getDoc(ref);

        if (!snap.exists()) return [];

        const data = snap.data();
        const list = Array.isArray(data.list) ? data.list : [];

        // 3️⃣ 캐시 저장
        sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                updatedAt: Date.now(),
                list
            })
        );

        return list;

    } catch (err) {
        console.error("랭킹 로드 실패", err);
        return [];
    }
}

