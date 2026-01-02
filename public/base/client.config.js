// /base/client.config.js
// 🔒 [PRODUCTION DEFAULT CONFIG]
// 이 파일은 배포 기준입니다.
// 개발 시에는 client.config.dev.js로 교체해서 사용하세요.

export const CLIENT_CONFIG = {
    API_BASE: "https://ai-proxy2.vercel.app/api",

    MODE: "prod",

    DEBUG: false,
};
