// functions/battle/processOneBattle.js

const { VertexAI } = require("@google-cloud/vertexai"); // ✅ Vertex
const { admin, db } = require("../admin/admin");
const { ORIGINS } = require("./origins");

const { getSkillEvaluation } = require("./aiSkillEval");
const { calcHP } = require("./calcBattle");
const { pickRandom3Skills, calcOrderWeight, simulateTurn } = require("./skillEngine");

const {
    SYSTEM_PROMPT,
    buildUserPrompt,
    evaluateBattleFlow,
    pickOpening
} = require("./battleNarrationPrompt");

/* =========================================================
   ✅ Vertex 공통 설정
========================================================= */
function getVertex() {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!projectId) throw new Error("GCP project id missing (GCLOUD_PROJECT / GCP_PROJECT).");

    // ✅ 유저 요구: 2.5 flash lite를 위해 us-central1 고정
    const location = "us-central1";
    return new VertexAI({ project: projectId, location });
}

function extractTextFromVertexResponse(response) {
    // candidates[0].content.parts[].text 를 전부 합침
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts.map(p => p?.text || "").join("");
}

function extractTextFromVertexChunk(chunk) {
    // SDK/버전에 따라 chunk.text()가 있기도 하고 없기도 해서 방어적으로 처리
    if (chunk && typeof chunk.text === "function") {
        const t = chunk.text();
        return typeof t === "string" ? t : "";
    }

    const parts = chunk?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts.map(p => p?.text || "").join("");
}

/* =========================================================
   ✅ AI 전투 로그 생성 (Vertex Stream)
========================================================= */
async function generateBattleNarrationStream({
    battleRef,
    my,
    enemy,
    myPicked,
    enemyPicked,
    myTop2Idx,
    enemyTop2Idx,
    turnLogs,
    winnerId,
    myId,
    enemyId
}) {
    const myOriginName = ORIGINS[my.originId]?.name || "";
    const enemyOriginName = ORIGINS[enemy.originId]?.name || "";

    // ✅ winnerId는 문서ID 기준
    const winnerName = winnerId === myId ? my.displayRawName : enemy.displayRawName;
    const loserName = winnerId === myId ? enemy.displayRawName : my.displayRawName;

    const userPrompt = buildUserPrompt({
        my,
        enemy,
        myOriginName,
        enemyOriginName,
        mySkills: myPicked,
        enemySkills: enemyPicked,
        myTop2Idx,
        enemyTop2Idx,
        openingType: pickOpening(),
        midResultType: evaluateBattleFlow(turnLogs),
        winnerName,
        loserName
    });

    const vertexAI = getVertex();

    // ✅ 유저 요구: gemini-2.5-flash-lite
    const model = vertexAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
    });

    const stream = await model.generateContentStream({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
            temperature: 0.45,
            topP: 0.85,
            maxOutputTokens: 1200
        }
    });

    let buffer = "";
    let fullText = "";
    let previewSaved = false;
    let lastFlushTime = Date.now();

    const MIN_UPLOAD_SIZE = 300;      // 글자 최소 기준
    const MIN_FLUSH_INTERVAL = 1000;  // 1초 최소 간격

    async function flushChunk(text) {
        fullText += text;

        try {
            await battleRef.collection("logs").add({
                text,
                createdAt: admin.firestore.Timestamp.now()
            });

            if (!previewSaved) {
                const PREVIEW_LEN = 180;
                const previewText =
                    fullText.length > PREVIEW_LEN ? fullText.slice(0, PREVIEW_LEN) : fullText;

                await battleRef.update({ previewText });
                previewSaved = true;
            }
        } catch (e) {
            console.error("[STREAM_WRITE_FAIL]", e?.message || String(e));
        }

        lastFlushTime = Date.now();
    }

    for await (const chunk of stream.stream) {
        const part = extractTextFromVertexChunk(chunk);
        if (!part) continue;

        buffer += part;

        const now = Date.now();
        const timePassed = now - lastFlushTime;

        if (buffer.length >= MIN_UPLOAD_SIZE && timePassed >= MIN_FLUSH_INTERVAL) {
            await flushChunk(buffer);
            buffer = "";
        }
    }

    // ✅ 스트림 종료 후 남은 부분 업로드
    if (buffer.trim().length > 0) {
        await flushChunk(buffer);
    }

    return fullText;
}

/* =========================================================
   기존 전투 로직 (변경 없음, 호출부만 Vertex 사용)
========================================================= */
async function runBattleLogic(battleId, myId, enemyId) {
    const callStartTime = Date.now();

    const mySnap = await db.collection("characters").doc(myId).get();
    const enemySnap = await db.collection("characters").doc(enemyId).get();

    if (!mySnap.exists || !enemySnap.exists) throw new Error("캐릭터 정보를 가져올 수 없음");

    const my = mySnap.data();
    const enemy = enemySnap.data();

    // 1) AI에게 4개 스킬 기반 평가 요청 (aiSkillEval.js가 Vertex로 바뀐 상태)
    const aiEval = await getSkillEvaluation(my, enemy);

    // 2) 4개 중 3개 랜덤 추출
    const myPicked = pickRandom3Skills(my.skills);
    const enemyPicked = pickRandom3Skills(enemy.skills);

    // 뽑힌 3개 스킬이 원래 4개 중 몇 번이었는지
    const myPickedIndices = myPicked.map((p) => my.skills.findIndex((s) => s.name === p.name));
    const enemyPickedIndices = enemyPicked.map((p) =>
        enemy.skills.findIndex((s) => s.name === p.name)
    );

    // 3) 순서 가중치 계산
    const myOrderWeight = calcOrderWeight(aiEval.myOrder, myPickedIndices);
    const enemyOrderWeight = calcOrderWeight(aiEval.enemyOrder, enemyPickedIndices);

    let myHP = calcHP(
        my.scores,
        my.regionScore || 0,
        my.image?.fitScore || 0
    );

    let enemyHP = calcHP(
        enemy.scores,
        enemy.regionScore || 0,
        enemy.image?.fitScore || 0
    );
    const context = {
        auraQueue: [],
        aura: {
            my: { AP: 0, BP: 0, AN: 0, BN: 0 },
            enemy: { AP: 0, BP: 0, AN: 0, BN: 0 }
        }
    };

    const turnLogs = [];
    for (let turn = 1; turn <= 3; turn++) {
        const result = simulateTurn({
            turn,
            mySkill: myPicked[turn - 1],
            enemySkill: enemyPicked[turn - 1],
            myTF: aiEval.myTF[myPickedIndices[turn - 1]],
            enemyTF: aiEval.enemyTF[enemyPickedIndices[turn - 1]],
            mySupport: my.scores.supportScore,
            enemySupport: enemy.scores.supportScore,
            myCombat: my.scores.combatScore,
            enemyCombat: enemy.scores.combatScore,
            myOrderWeight,
            enemyOrderWeight,
            context
        });

        enemyHP -= result.dmgToEnemy;
        myHP -= result.dmgToMe;

        turnLogs.push({
            turn,
            my: { ...result.detail.my, hpAfter: myHP },
            enemy: { ...result.detail.enemy, hpAfter: enemyHP }
        });

        if (myHP <= 0 || enemyHP <= 0) break;
    }

    let winnerId;

    function pickTop2SkillIdx(turnLogs, isMy) {
        const arr = turnLogs.map((log, i) => ({
            idx: i,
            dmg: isMy ? log.my.totalDmg : log.enemy.totalDmg
        }));

        arr.sort((a, b) => b.dmg - a.dmg);
        return arr.slice(0, 2).map((v) => v.idx);
    }

    let myTop2Idx = null;
    let enemyTop2Idx = null;

    if (turnLogs.length === 3) {
        myTop2Idx = pickTop2SkillIdx(turnLogs, true);
        enemyTop2Idx = pickTop2SkillIdx(turnLogs, false);
    }

    if (myHP > enemyHP) winnerId = myId;
    else if (enemyHP > myHP) winnerId = enemyId;
    else winnerId = Math.random() < 0.5 ? myId : enemyId;

    const loserId = winnerId === myId ? enemyId : myId;
    const battleRef = db.collection("battles").doc(battleId);

    await battleRef.update({
        winnerId,
        loserId,
        status: "streaming",
        finished: false
    });

    const battleLogicEndTime = Date.now();
    const usedTurnCount = turnLogs.length;

    try {
        await generateBattleNarrationStream({
            battleRef,
            my,
            enemy,
            myPicked: myPicked.slice(0, usedTurnCount),
            enemyPicked: enemyPicked.slice(0, usedTurnCount),
            myTop2Idx,
            enemyTop2Idx,
            turnLogs,
            winnerId,
            myId,
            enemyId
        });
    } catch (streamErr) {
        console.error("[STREAM_FAIL]", streamErr?.message || String(streamErr));

        await battleRef.update({
            status: "stream_error",
            streamFailed: true,
            finished: true,
            tarotEligible: false,
            finishedAt: admin.firestore.Timestamp.now()
        });
    }

    const narrationEndTime = Date.now();
    const logicTime = battleLogicEndTime - callStartTime;
    const logTime = narrationEndTime - battleLogicEndTime;
    const totalTime = narrationEndTime - callStartTime;

    return {
        winnerId,
        loserId,
        turnLogs,
        myName: my.displayRawName,
        enemyName: enemy.displayRawName,
        timing: { logicTime, logTime, totalTime }
    };
}

/* =========================================================
   Worker 엔트리포인트
========================================================= */
exports.processOneBattle = async (battleId, battleData) => {
    const ref = db.collection("battles").doc(battleId);

    try {
        const result = await runBattleLogic(battleId, battleData.myId, battleData.enemyId);

        await ref.update({
            status: "done",
            finished: true,
            tarotEligible: true,

            turnLogs: result.turnLogs,
            myName: result.myName,
            enemyName: result.enemyName,
            timing: result.timing,
            finishedAt: admin.firestore.Timestamp.now()
        });
    } catch (e) {
        await ref.update({
            status: "error",
            errorMsg: e?.message || String(e)
        });
    }
};