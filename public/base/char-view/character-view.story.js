import { parseStoryText } from "/base/common/story-parser.js";
//✅
export function renderStoryPreview({
    content,
    battlePager,
    fullStoryText,
    openDetailDialog
}) {
    battlePager.style.display = "none";

    const MAX = 100;
    const plain = fullStoryText || "";
    const isOverflow = plain.length > MAX;
    const shortText = isOverflow ? plain.slice(0, MAX) + "..." : plain;

    const previewHtml = parseStoryText(shortText)
        .replace(/<br\s*\/?>/gi, " ");

    content.innerHTML = `
        <div class="story-preview clickable-preview text-flow" id="storyPreview">
            ${previewHtml || "(스토리 없음)"}
        </div>
    `;

    document
        .getElementById("storyPreview")
        .addEventListener("click", () => {
            openDetailDialog(
                "전체 스토리",
                parseStoryText(fullStoryText)
            );
        });
}


export function renderSkills({
    content,
    battlePager,
    skills
}) {
    battlePager.style.display = "none";

    if (!Array.isArray(skills) || !skills.length) {
        content.innerHTML = "<div>(스킬 없음)</div>";
        return;
    }

    content.innerHTML = skills
        .map(
            (s) => `
            <div class="skill-box">
                <div class="skill-name">${s.name || "이름 없음"}</div>
                <div class="skill-desc text-flow">
                    ${parseStoryText(s.longDesc || "")}
                </div>
            </div>
        `
        )
        .join("");
}
