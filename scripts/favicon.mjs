// Favicon for every Discovery page — the broberg.ai "Modulær kerne" mark from cms
// (design A, Christian's pick; cms mockup 66e188d0): one emerald core → four
// reused modules. Emerald stroke on transparent → legible on light + dark tabs.
// Stroke 2 / opacity 1 per cms's 16px-legibility tip. Inlined as a data-URI so a
// page stays self-contained. ONE source: /onboarding had no icon for as long as
// this lived inside build-inventory.mjs (F038.25, Christian 9/10 2026).
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="none" stroke="#34d399" stroke-width="2" opacity="1"><path d="M16 16 8 8M16 16 24 8M16 16 8 24M16 16 24 24"/><rect x="4" y="4" width="8" height="8" rx="2.2"/><rect x="20" y="4" width="8" height="8" rx="2.2"/><rect x="4" y="20" width="8" height="8" rx="2.2"/><rect x="20" y="20" width="8" height="8" rx="2.2"/></g><circle cx="16" cy="16" r="3.2" fill="#34d399"/></svg>`;
export const FAVICON = "data:image/svg+xml;base64," + Buffer.from(FAVICON_SVG).toString("base64");
export const FAVICON_LINK = `<link rel="icon" href="${FAVICON}">`;
