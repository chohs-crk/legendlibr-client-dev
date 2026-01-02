// /base/character-view.auth.js

import { apiFetchMe } from "./character-view.api.js";

/* 🔐 페이지 진입 시 인증 확인 (기존 로직 그대로) */
export async function requireAuthOrRedirect() {
    const res = await apiFetchMe();
    if (res.status === 401) {
        location.href = "/base/login.html";
        throw new Error("NOT_LOGGED_IN");
    }
    if (!res.ok) throw new Error("AUTH_CHECK_FAILED");
    return await res.json();
}
