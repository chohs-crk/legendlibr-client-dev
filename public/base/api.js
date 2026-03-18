import { CLIENT_CONFIG } from "./client.config.js";

export async function apiFetch(path, options = {}) {
    const res = await fetch(CLIENT_CONFIG.API_BASE + path, {
        credentials: "include",
        ...options,
    });

    if (res.status === 401) {
        window.dispatchEvent(new Event("auth-expired"));
    }

    return res;
}
