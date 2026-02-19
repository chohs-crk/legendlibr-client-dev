import { apiFetch } from "/base/api.js";

export function apiFetchCharacterById(id) {
    return apiFetch(`/base/characters?id=${encodeURIComponent(id)}`);
}

export function apiFetchBattlesList(charId, page, pageSize) {
    return apiFetch(
        `/base/battles-list?charId=${encodeURIComponent(charId)}&page=${page}&pageSize=${pageSize}`
    );
}
export function apiFetchRegionMeta(regionId) {
    return apiFetch("/base/region-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId })
    });
}
export function apiDownloadRegion(regionId) {
    return apiFetch("/base/region-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId })
    });
}
