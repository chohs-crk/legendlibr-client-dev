/* base/journey.js */
export function initJourneyPage() {
    const btnBattle = document.getElementById("btnBattle");
    const btnRaid = document.getElementById("btnRaid");

    if (btnBattle) {
        // base/journey.js (변경)
        btnBattle.onclick = () => {
            showPage("battle");
        };

    }

    if (btnRaid) {
        btnRaid.onclick = () => {
            // 외부 페이지(/raid/raid.html)로 이동
            window.location.href = "/raid/raid.html";
        };
    }
}