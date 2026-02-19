// /base/character-view.view.js
//✅
import { requireAuthOrRedirect } from "../auth.js";
import { initCharacterViewUI } from "./character-view.ui.js";

export async function initCharacterViewPage() {
    await requireAuthOrRedirect();
    initCharacterViewUI();
}

