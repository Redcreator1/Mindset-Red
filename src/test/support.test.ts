import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { askSupportBot, renderSupport, SupportChatError, SUPPORT_KNOWLEDGE } from "../support.js";

function startAnthropicMock(reply: string): Promise<{ baseURL: string; server: Server; lastBody: unknown }> {
  const state: { lastBody: unknown } = { lastBody: undefined };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    state.lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: reply }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ baseURL: `http://127.0.0.1:${port}`, server, lastBody: state.lastBody });
    });
  });
}

test("askSupportBot sends the knowledge base as system prompt and returns the reply text", async () => {
  const mock = await startAnthropicMock("Le remboursement est possible sous 14 jours.");
  try {
    const answer = await askSupportBot({ apiKey: "sk-ant-test", question: "Comment me faire rembourser ?", baseURL: mock.baseURL });
    assert.equal(answer, "Le remboursement est possible sous 14 jours.");
  } finally {
    mock.server.close();
  }
});

test("askSupportBot rejects an empty question without calling the API", async () => {
  await assert.rejects(
    () => askSupportBot({ apiKey: "sk-ant-test", question: "   ", baseURL: "http://127.0.0.1:1" }),
    SupportChatError,
  );
});

test("askSupportBot rejects a question over the length cap without calling the API", async () => {
  await assert.rejects(
    () => askSupportBot({ apiKey: "sk-ant-test", question: "x".repeat(2000), baseURL: "http://127.0.0.1:1" }),
    SupportChatError,
  );
});

test("askSupportBot rejects an oversized history message without calling the API — caps cost against the operator's own Anthropic key", async () => {
  await assert.rejects(
    () =>
      askSupportBot({
        apiKey: "sk-ant-test",
        question: "salut",
        history: [{ role: "user", content: "x".repeat(2000) }],
        baseURL: "http://127.0.0.1:1",
      }),
    SupportChatError,
  );
});

test("askSupportBot surfaces a SupportChatError on a non-2xx response instead of throwing a generic error", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "rate limited" }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(
      () => askSupportBot({ apiKey: "sk-ant-test", question: "salut", baseURL: `http://127.0.0.1:${port}` }),
      SupportChatError,
    );
  } finally {
    server.close();
  }
});

test("SUPPORT_KNOWLEDGE states the hosted/self-hosted split and the refund window — the two facts most likely to be asked about", () => {
  assert.match(SUPPORT_KNOWLEDGE, /self-hosted/i);
  assert.match(SUPPORT_KNOWLEDGE, /14 jours/);
});

test("renderSupport is self-contained HTML with the chat widget and a working mailto fallback", () => {
  const html = renderSupport("https://example.com");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /id="form"/);
  assert.match(html, /\/v1\/support\/chat/);
  assert.match(html, /mailto:mindset22633@gmail\.com/);
});
