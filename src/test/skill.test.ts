import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL_MARKER } from "../generators.js";

// dist/test/skill.test.js → repo root
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = join(root, "skills", "mindset-ctx");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");

function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with a YAML frontmatter block");
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

test("SKILL.md has a valid name and description", () => {
  const fm = frontmatter(skill);
  assert.equal(fm.name, "mindset-ctx", "name must match the skill directory");
  assert.match(fm.name, /^[a-z0-9-]{1,64}$/);
  assert.ok(fm.description && fm.description.length > 50, "description must say what and when");
  assert.ok(fm.description.length <= 1024, "description must stay under 1024 chars");
});

test("SKILL.md quotes the exact manual marker the generators write", () => {
  assert.ok(skill.includes(MANUAL_MARKER), "marker in SKILL.md drifted from generators.ts");
});

test("SKILL.md only references files that exist in the skill", () => {
  for (const [, link] of skill.matchAll(/\]\((references\/[^)]+)\)/g)) {
    assert.ok(existsSync(join(skillDir, link)), `missing ${link}`);
  }
});

test("SKILL.md only uses CLI commands that exist", () => {
  const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
  const cmds = [...skill.matchAll(/npx -y mindset-ctx (\w+)/g)];
  assert.ok(cmds.length > 0, "expected npx commands in SKILL.md");
  for (const [, cmd] of cmds) {
    assert.ok(cli.includes(`ctx ${cmd}`), `SKILL.md uses unknown command "${cmd}"`);
  }
});
