/**
 * The browser-tab icon — same context-brackets mark as everywhere else
 * (og-image.ts, the VS Code extension's icon), simplified for small sizes.
 * Served as SVG (GET /favicon.svg): supported by every modern browser,
 * self-hosted, no external asset or build step needed.
 */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b1220"/>
  <path d="M22 16 L14 16 Q10 16 10 20 L10 44 Q10 48 14 48 L22 48" fill="none" stroke="#60a5fa" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M42 16 L50 16 Q54 16 54 20 L54 44 Q54 48 50 48 L42 48" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="9" fill="#3b82f6"/>
</svg>
`;
