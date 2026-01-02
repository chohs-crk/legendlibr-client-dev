export function resolveCharImage(image) {
    if (!image) return "/images/base/base_01.png";

    if (image.type === "ai" && image.url) return image.url;
    if (image.type === "preset" && image.key)
        return `/images/preset/${image.key}.png`;
    if (image.type === "base" && image.key)
        return `/images/base/${image.key}.png`;

    return "/images/base/base_01.png";
}
