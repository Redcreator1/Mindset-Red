import test from "node:test";
import assert from "node:assert/strict";
import { ogImageBytes } from "../og-image.js";
import { ogMeta } from "../home.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("ogImageBytes decodes to a real PNG (correct magic bytes) at the standard 1200x630 OG size", () => {
  const buf = ogImageBytes();
  const bytes = new Uint8Array(buf);
  assert.deepEqual([...bytes.slice(0, 8)], PNG_MAGIC);
  // IHDR chunk: width/height are the 4-byte big-endian ints right after it, at offset 16/20.
  const width = new DataView(buf).getUint32(16);
  const height = new DataView(buf).getUint32(20);
  assert.equal(width, 1200);
  assert.equal(height, 630);
});

test("ogMeta emits absolute og:image/og:url only when a baseUrl is given, relative otherwise omitted", () => {
  const withBase = ogMeta({ title: "T", description: "D", baseUrl: "https://ctx.example.com", path: "/blog" });
  assert.match(withBase, /<meta property="og:image" content="https:\/\/ctx\.example\.com\/og-image\.png">/);
  assert.match(withBase, /<meta property="og:url" content="https:\/\/ctx\.example\.com\/blog">/);
  assert.match(withBase, /<meta name="twitter:card" content="summary_large_image">/);

  const withoutBase = ogMeta({ title: "T", description: "D" });
  assert.ok(!withoutBase.includes("og:image"), "no broken relative og:image without a baseUrl");
  assert.ok(!withoutBase.includes("og:url"));
});
