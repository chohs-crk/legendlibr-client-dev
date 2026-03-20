/* base/journey.js */
export function initJourneyPage() {
    const btnBattle = document.getElementById("btnBattle");
    const btnRaid = document.getElementById("btnRaid");

    if (btnBattle) {
        // base/journey.js (º¯°æ)
        btnBattle.onclick = () => {
            showPage("battle");
        };

    }

   
}