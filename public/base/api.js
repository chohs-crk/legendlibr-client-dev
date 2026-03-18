import { CLIENT_CONFIG } from "./client.config.js";
import { auth } from "./firebase.js"; // 실제 firebase 초기화 파일 경로에 맞게 수정

export async function apiFetch(path, options = {}) {
    const user = auth.currentUser;
    let token = null;

    try {
        if (user) {
            token = await user.getIdToken();
        }
    } catch (e) {
        console.warn("ID token load failed:", e);
    }

    const headers = new Headers(options.headers || {});
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    const res = await fetch(CLIENT_CONFIG.API_BASE + path, {
        credentials: "include",
        ...options,
        headers,
    });

    if (res.status === 401) {
        window.dispatchEvent(new Event("auth-expired"));
    }

    return res;
}