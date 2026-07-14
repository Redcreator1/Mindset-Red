/** Pure status-bar text/tooltip logic — no `vscode` import, unit-testable directly. */

export interface StatusDisplay {
  text: string;
  tooltip: string;
}

export function statusFor(hasClaudeMd: boolean): StatusDisplay {
  return hasClaudeMd
    ? { text: "$(check) mindset-ctx", tooltip: "CLAUDE.md present — click to regenerate" }
    : { text: "$(warning) mindset-ctx: no context", tooltip: "No CLAUDE.md found in this workspace — click to generate" };
}
