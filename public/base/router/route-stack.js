// /base/router/route-stack.js
// 앱 내부 뒤로가기 전용 스택 (sessionStorage)만 담당

const STORAGE_KEY = "__appStackV1";

export function loadStack() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveStack(stack) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
}

export function getTop(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}

export function isSameEntry(a, b) {
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    (a.charId || null) === (b.charId || null) &&
    (a.battleId || null) === (b.battleId || null)
  );
}

/**
 * anchor = footer 루트(home/journey/ranking/setting) 또는 첫 진입
 */
export function findLastAnchor(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.isAnchor) return stack[i];
  }
  return stack[0] || null;
}

/**
 * stack 안에서 target과 동일한 엔트리를 찾고,
 * target 위의 엔트리를 모두 삭제한 새 stack을 반환
 */
export function cutStackToTarget(stack, target) {
  let cutIdx = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    const it = stack[i];
    if (
      it.name === target.name &&
      (it.charId || null) === (target.charId || null) &&
      (it.battleId || null) === (target.battleId || null)
    ) {
      cutIdx = i;
      break;
    }
  }
  if (cutIdx < 0) return null;

  const next = stack.slice(0, cutIdx + 1);
  return next;
}
