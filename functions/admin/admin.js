const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.GCLOUD_PROJECT,
    });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = {
    admin,
    db,
    auth,
};
