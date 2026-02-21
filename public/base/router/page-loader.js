// /base/router/page-loader.js
// HTML partial을 로드해서 DOM에 "마운트"하는 책임만 담당

import { PAGES, getPartialUrl } from "./route-config.js";

const loaded = new Set();

/**
 * pages-root에 partial(section)을 삽입한다.
 * - partial 파일은 반드시 <section id="page-..."> 하나를 루트로 가진다.
 */
export async function ensurePageMounted(name) {
  if (loaded.has(name)) return;

  const root = document.getElementById("pages-root");
  if (!root) throw new Error('[router] #pages-root not found');

  const url = getPartialUrl(name);
  if (!url) throw new Error(`[router] partial url not found: ${name}`);

  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`[router] failed to fetch partial: ${name} (${res.status})`);
  }

  const html = (await res.text()).trim();
  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  const section = tpl.content.firstElementChild;
  if (!section || section.tagName !== "SECTION") {
    throw new Error(`[router] partial root must be <section>: ${name}`);
  }

  root.appendChild(tpl.content);
  loaded.add(name);
}

/**
 * 초기 진입 시 전체 페이지 partial을 한 번에 마운트
 * - 기존 index.html처럼 "DOM은 전부 존재"하게 만들고 싶을 때 안전한 옵션
 */
export async function mountAllPages() {
  await Promise.all(PAGES.map((n) => ensurePageMounted(n)));
}
