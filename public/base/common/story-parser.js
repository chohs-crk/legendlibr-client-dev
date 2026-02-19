// /base/common/story-parser.js
//✅
export function parseStoryText(raw) {
    if (!raw) return "";

    let html = String(raw);

    html = html.replace(/story-(em|talk|skill)\"?>/gi, "");
    html = html.replace(/<span[^>]*>/gi, "");
    html = html.replace(/<\/span>/gi, "");
    html = html.replace(/&lt;\/?span[^&]*&gt;/gi, "");

    html = html.replace(/\*\*(.+?)\*\*/g, (_, txt) =>
        `<span class="story-em">${txt}</span>`
    );

    html = html.replace(/§([^§]+?)§/g, (_, txt) =>
        `"${'<span class="story-talk">' + txt + "</span>"}"`
    );

    html = html.replace(/『(.+?)』/g, (_, txt) =>
        `『<span class="story-skill">${txt}</span>』`
    );

    html = html.replace(/\r\n/g, "\n");
    html = html.replace(/\n{2,}/g, "<br><br>");
    html = html.replace(/\n/g, " ");

    return html.trim();
}
