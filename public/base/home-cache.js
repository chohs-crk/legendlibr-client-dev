// /base/home-cache.js

const HOME_CHARACTERS_KEY = "homeCharacters";

function normalizeHomeCharacters(arr) {
    if (!Array.isArray(arr)) return [];

    return arr.filter((item) => {
        return (
            item &&
            typeof item === "object" &&
            typeof item.id === "string" &&
            item.isMine === true
        );
    });
}

export function readHomeCharactersCache() {
    const raw = sessionStorage.getItem(HOME_CHARACTERS_KEY);
    if (!raw) return [];

    try {
        return normalizeHomeCharacters(JSON.parse(raw));
    } catch {
        return [];
    }
}

export function writeHomeCharactersCache(list) {
    const safe = normalizeHomeCharacters(list);
    sessionStorage.setItem(HOME_CHARACTERS_KEY, JSON.stringify(safe));
    return safe;
}

export function sanitizeHomeCharactersCache() {
    const safe = readHomeCharactersCache();
    sessionStorage.setItem(HOME_CHARACTERS_KEY, JSON.stringify(safe));
    return safe;
}

export function upsertMyCharacterCache(character) {
    if (!character || character.isMine !== true || !character.id) {
        return readHomeCharactersCache();
    }

    const list = readHomeCharactersCache();
    const index = list.findIndex((c) => c.id === character.id);

    if (index !== -1) {
        list[index] = {
            ...list[index],
            ...character,
            isMine: true
        };
    } else {
        list.push({
            ...character,
            isMine: true
        });
    }

    return writeHomeCharactersCache(list);
}

export function removeCharacterFromHomeCache(charId) {
    if (!charId) return readHomeCharactersCache();

    const list = readHomeCharactersCache().filter((c) => c.id !== charId);
    return writeHomeCharactersCache(list);
}

export function clearHomeCharactersCache() {
    sessionStorage.removeItem(HOME_CHARACTERS_KEY);
}