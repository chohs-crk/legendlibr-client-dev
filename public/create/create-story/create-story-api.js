/* ================================
   API
================================ */
import { apiFetch } from "/base/api.js";

export const API = {
    check: "/create/story-check",
    story1: "/create/story1",
    story3: "/create/story3",
    final: "/create/final"
};

export async function fetchSceneState() {
    const res = await apiFetch(API.check);
    return res.json();
}

export async function requestSceneStream(flow, force = false) {
    return apiFetch(API[flow], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
    });
}

export async function submitChoice(flow, index) {
    return apiFetch(API[flow], {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index })
    });
}

export function buildFinalErrorMessage(data) {
    const code = data?.error;

    if (code === "CHARACTER_LIMIT_REACHED") {
        return "보유 가능한 캐릭터 수를 초과했습니다.";
    }
    if (code === "NO_REGION") {
        return "선택한 지역 정보를 확인할 수 없습니다.";
    }
    if (code === "REGION_NOT_REGISTERED") {
        return "해당 지역에 캐릭터를 등록할 수 없습니다.";
    }
    if (code === "AI_ENDING_INVALID") {
        return "결말 생성 형식이 올바르지 않아 다시 시도해야 합니다.";
    }
    if (code === "AI_STATS_INVALID") {
        return "스킬 생성 형식이 올바르지 않아 다시 시도해야 합니다.";
    }

    return "캐릭터 생성 중 문제가 발생했습니다.";
}

export async function requestFinalPreview() {
    while (true) {
        const res = await apiFetch(API.final, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "preview" })
        });
        const data = await res.json();

        if (data?.ok && (data.status === "preview_done" || data.status === "done")) {
            return data;
        }

        if (data?.ok && data.status === "waiting") {
            await new Promise(resolve => setTimeout(resolve, 700));
            continue;
        }

        throw new Error(buildFinalErrorMessage(data));
    }
}

export async function requestFinalComplete() {
    while (true) {
        const res = await apiFetch(API.final, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "complete" })
        });
        const data = await res.json();

        if (data?.ok && data.status === "done" && data.id) {
            return data;
        }

        if (data?.ok && data.status === "waiting") {
            await new Promise(resolve => setTimeout(resolve, 800));
            continue;
        }

        throw new Error(buildFinalErrorMessage(data));
    }
}
