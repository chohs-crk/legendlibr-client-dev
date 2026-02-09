import { apiFetch } from "/base/api.js";

export function apiFetchMe() {
    return apiFetch("/base/me");
}

export async function requireAuthOrRedirect() {
    const res = await apiFetchMe();
    if (res.status === 401) {
        location.href = "/base/login.html";
        throw new Error("NOT_LOGGED_IN");
    }
    if (!res.ok) throw new Error("AUTH_CHECK_FAILED");
    return res.json();
}
