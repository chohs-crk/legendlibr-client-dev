import { apiFetch } from "/base/api.js";



export function apiFetchCharacterById(id) {
    return apiFetch(`/base/characters?id=${encodeURIComponent(id)}`);
}

export function apiFetchBattlesList(charId, page, pageSize) {
    return apiFetch(
        `/base/battles-list?charId=${encodeURIComponent(charId)}&page=${page}&pageSize=${pageSize}`
    );
}

export function apiFetchUserMeta() {
    return apiFetch("/base/user-meta");
}
