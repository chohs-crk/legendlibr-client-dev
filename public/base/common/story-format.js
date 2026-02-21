export function formatStoryWithDialogue(text) {
    if (!text) return "";

    const blocks = [];
    const dialogueRegex = /§[^§]*§/g; // ✅ FIX

    let lastIndex = 0;
    let match;

    while ((match = dialogueRegex.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index);
        pushSentences(before, blocks);
        blocks.push({ type: "dialogue", text: match[0] });
        lastIndex = dialogueRegex.lastIndex;
    }

    pushSentences(text.slice(lastIndex), blocks);

    let result = "";
    let sentenceGroupCount = 0;

    for (const block of blocks) {
        if (block.type === "dialogue") {
            sentenceGroupCount = 0;

            // 직전 개행 제거 후 대사 앞뒤는 정확히 \n\n
            result = result.replace(/\n+$/, "");
            if (result.length > 0) result += "\n\n";

            result += block.text + "\n\n";
            continue;
        }

        sentenceGroupCount++;
        result += block.text + "\n";

        if (sentenceGroupCount % 2 === 0) {
            result += "\n";
        }
    }

    return result.replace(/\n{3,}/g, "\n\n").trim();
}

function pushSentences(text, blocks) {
    const sentences = text
        .split(/(?<!\d)(?<=[.!?。！？])\s+/) // ✅ FIX
        .map((s) => s.trim())
        .filter(Boolean);

    for (const s of sentences) {
        blocks.push({ type: "sentence", text: s });
    }
}
