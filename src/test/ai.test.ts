import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateNarrative } from "../ai.js";
import { generateAll, generateClaudeMd } from "../generators.js";
import { analyzeRepo } from "../analyzer.js";

test("generateNarrative calls the Messages API and returns Claude's text", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const mock = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test", type: "message", role: "assistant", model: "claude-opus-4-8",
          content: [
            { type: "thinking", thinking: "", signature: "" },
            { type: "text", text: "This project is a tiny fixture used to test AI narratives." },
          ],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      );
    });
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseURL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

  const dir = mkdtempSync(join(tmpdir(), "ctx-ai-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ai-fixture", description: "AI fixture" }));
  writeFileSync(join(dir, "README.md"), "# ai-fixture\n\nA fixture.\n");

  try {
    const narrative = await generateNarrative(analyzeRepo(dir), { baseURL, apiKey: "test-key" });
    assert.equal(narrative, "This project is a tiny fixture used to test AI narratives.");
    assert.equal(capturedBody!.model, "claude-opus-4-8");
    assert.deepEqual(capturedBody!.thinking, { type: "adaptive" });
    assert.ok(String(capturedBody!.system).includes("AI coding agents"));
    const userContent = (capturedBody!.messages as { content: string }[])[0].content;
    assert.ok(userContent.includes("ai-fixture"), "analysis is sent to the model");
    assert.ok(userContent.includes("A fixture."), "README is sent to the model");
  } finally {
    mock.close();
  }
});

test("narrative flows into CLAUDE.md and the architecture doc", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-ai-gen-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "narrated" }));
  const a = analyzeRepo(dir);
  const narrative = "A narrated overview paragraph.";

  const claude = generateClaudeMd(a, narrative);
  assert.ok(claude.content.includes("A narrated overview paragraph."));

  const files = generateAll(a, narrative);
  const arch = files.find((f) => f.path === "docs/ARCHITECTURE.md")!;
  assert.ok(arch.content.includes("## Narrative overview"));
  assert.ok(arch.content.includes("A narrated overview paragraph."));

  const withoutNarrative = generateAll(a).find((f) => f.path === "docs/ARCHITECTURE.md")!;
  assert.ok(!withoutNarrative.content.includes("## Narrative overview"), "section only appears with --ai");
});
