/* base/setting.js */
import { apiFetch } from "/base/api.js";

export function initSettingPage() {
    const btnLogout = document.getElementById("btnLogout");
    if (!btnLogout) return;

    // 이벤트 리스너가 중복 등록되지 않도록 한 번만 설정
    btnLogout.onclick = async () => {
        const ok = confirm("정말 로그아웃 하시겠습니까?");
        if (!ok) return;

        try {
            await apiFetch("/base/auth?action=logout", {
                method: "POST"
            });
            // SPA 외부인 로그인 페이지로 완전히 이동
            sessionStorage.clear();
            location.href = "/base/login.html";

        } catch (err) {
            console.error("로그아웃 실패:", err);
            alert("로그아웃에 실패했습니다.");
        }
    };
}