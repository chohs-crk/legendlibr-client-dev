// functions/battle/processOneBattle.js

const { GoogleGenerativeAI } = require("@google/generative-ai"); // 🔥 추가
const { defineSecret } = require("firebase-functions/params");
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

// 🔥 OpenAI 키 대신 Gemini 키 정의
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/* =========================================================
   🔥 AI 전투 로그 생성 (Gemini 버전)
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
    winnerId
}) {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) throw new Error("Gemini API KEY is missing!");

    const myOriginName = ORIGINS[my.originId]?.name || "";
    const enemyOriginName = ORIGINS[enemy.originId]?.name || "";

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite"
    });

    const winnerName =
        winnerId === my.uid ? my.displayRawName : enemy.displayRawName;

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
        winnerName
    });

    const stream = await model.generateContentStream({
        systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [
            { role: "user", parts: [{ text: userPrompt }] }
        ],
        generationConfig: {
            temperature: 0.8,
            topP: 0.85,
            maxOutputTokens: 1200
        }
    });

    let buffer = "";
    let fullText = "";
    let previewSaved = false;
    let lastFlushTime = Date.now();

    const MIN_UPLOAD_SIZE = 300;        // 글자 최소 기준
    const MIN_FLUSH_INTERVAL = 2500;    // 2.5초 최소 간격

    async function flushChunk(text) {

        fullText += text;

        try {
            await battleRef
                .collection("logs")
                .add({
                    text,
                    createdAt: admin.firestore.Timestamp.now()
                });

    
            if (!previewSaved) {
                const PREVIEW_LEN = 180;

                const previewText =
                    fullText.length > PREVIEW_LEN
                        ? fullText.slice(0, PREVIEW_LEN)
                        : fullText;

                await battleRef.update({
                    previewText
                });

                previewSaved = true;   // 🔥 한번 저장했으면 다시 안 함
            }




        } catch (e) {
            console.error("[STREAM_WRITE_FAIL]", e.message);
        }

        lastFlushTime = Date.now();
    }



    



    for await (const chunk of stream.stream) {
        const part = chunk.text();
        if (!part) continue;

        buffer += part;

        const now = Date.now();
        const timePassed = now - lastFlushTime;

        if (
            buffer.length >= MIN_UPLOAD_SIZE &&
            timePassed >= MIN_FLUSH_INTERVAL
        ) {
            await flushChunk(buffer);
            buffer = "";
        }

    }


    // 🔥 스트림 종료 후 남은 부분 업로드
    if (buffer.trim().length > 0) {

        const now = Date.now();
        const timePassed = now - lastFlushTime;

        if (timePassed < MIN_FLUSH_INTERVAL) {
            // 남은 시간만큼 대기
            await new Promise(r =>
                setTimeout(r, MIN_FLUSH_INTERVAL - timePassed)
            );
        }

        await flushChunk(buffer);
    }

    return fullText;
}





/* =========================================================
   🔥 실제 전투 로직
========================================================= */

async function runBattleLogic(battleId, myId, enemyId) {
    console.log("COLD START CHECK", process.uptime());

    const callStartTime = Date.now();

    const mySnap = await db.collection("characters").doc(myId).get();
    const enemySnap = await db.collection("characters").doc(enemyId).get();

    if (!mySnap.exists || !enemySnap.exists)
        throw new Error("캐릭터 정보를 가져올 수 없음");

    const my = mySnap.data();
    const enemy = enemySnap.data();

    // 1. AI에게 4개 스킬 기반 평가 요청
    let aiEval = await getSkillEvaluation(my, enemy);

    // 2. 4개 중 3개 랜덤 추출
    const myPicked = pickRandom3Skills(my.skills);
    const enemyPicked = pickRandom3Skills(enemy.skills);

    // 🔥 핵심 수정: 뽑힌 3개 스킬이 '원래 4개 중 몇 번'이었는지 인덱스 배열 생성
    // 예: [스킬A, 스킬B, 스킬D]가 뽑혔다면 [0, 1, 3]이 됨
    const myPickedIndices = myPicked.map(p => my.skills.findIndex(s => s.name === p.name));
    const enemyPickedIndices = enemyPicked.map(p => enemy.skills.findIndex(s => s.name === p.name));

    // 3. 순서 가중치 계산 (인덱스 배열을 넘겨줌)
    const myOrderWeight = calcOrderWeight(aiEval.myOrder, myPickedIndices);
    const enemyOrderWeight = calcOrderWeight(aiEval.enemyOrder, enemyPickedIndices);
    // 🔥 핵심 수정 1: HP 변수 초기화
    let myHP = calcHP(my.scores);
    let enemyHP = calcHP(enemy.scores);

    // 🔥 핵심 수정 2: 배틀마다 독립적인 auraQueue 생성 (전역 변수 오염 방지)
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
            // 🔥 수정: 원래 인덱스를 사용하여 정확한 TF 매칭
            myTF: aiEval.myTF[myPickedIndices[turn - 1]],
            enemyTF: aiEval.enemyTF[enemyPickedIndices[turn - 1]],
            mySupport: my.scores.supportScore,
            enemySupport: enemy.scores.supportScore,
            myCombat: my.scores.combatScore,
            enemyCombat: enemy.scores.combatScore,
            myOrderWeight,
            enemyOrderWeight,
            context // 🔥 배틀 상태 전달
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
    // 🔥 각 캐릭터가 가장 높은 데미지를 준 스킬 2개 인덱스 계산
    function pickTop2SkillIdx(turnLogs, isMy) {
        const arr = turnLogs.map((log, i) => ({
            idx: i,
            dmg: isMy ? log.my.totalDmg : log.enemy.totalDmg
        }));

        arr.sort((a, b) => b.dmg - a.dmg);
        return arr.slice(0, 2).map(v => v.idx);
    }

    let myTop2Idx = null;
    let enemyTop2Idx = null;

    // 🔥 3턴 모두 진행한 경우만 Top2 계산
    if (turnLogs.length === 3) {
        myTop2Idx = pickTop2SkillIdx(turnLogs, true);
        enemyTop2Idx = pickTop2SkillIdx(turnLogs, false);
    }




    if (myHP > enemyHP) winnerId = myId;
    else if (enemyHP > myHP) winnerId = enemyId;
    else winnerId = Math.random() < 0.5 ? myId : enemyId;

const loserId = winnerId === myId ? enemyId : myId;

const battleRef = db.collection("battles").doc(battleId);

// 🔥 승패 먼저 저장 (ELO는 아직 실행 안 됨)
    await battleRef.update({
        winnerId,
        loserId,
        status: "streaming",
        finished: false
    });


    const battleLogicEndTime = Date.now();

    const usedTurnCount = turnLogs.length;

    

 

let narration = "";
try {
    narration = await generateBattleNarrationStream({
        battleRef,
        my,
        enemy,
        myPicked: myPicked.slice(0, usedTurnCount),
        enemyPicked: enemyPicked.slice(0, usedTurnCount),
        myTop2Idx,
        enemyTop2Idx,
        turnLogs,
        winnerId
    });
} catch (streamErr) {
    console.error("[STREAM_FAIL]", streamErr.message);

    await battleRef.update({
        status: "stream_error",
        streamFailed: true,
        finished: true,
        tarotEligible: false,
        finishedAt: admin.firestore.Timestamp.now()   // 🔥 추가
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
   🔥 Worker 엔트리포인트
========================================================= */

exports.processOneBattle = async (battleId, battleData) => {

    const ref = db.collection("battles").doc(battleId);

    try {

     

        const result = await runBattleLogic(
            battleId,
            battleData.myId,
            battleData.enemyId
        );


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
            errorMsg: e.message
        });
    }
};
