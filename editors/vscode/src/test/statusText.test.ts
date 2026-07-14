import test from "node:test";
import assert from "node:assert/strict";
import { statusFor } from "../statusText";

test("statusFor reports a synced state when CLAUDE.md exists", () => {
  const status = statusFor(true);
  assert.match(status.text, /check/);
  assert.match(status.tooltip, /regenerate/);
});

test("statusFor reports a missing-context warning when CLAUDE.md doesn't exist", () => {
  const status = statusFor(false);
  assert.match(status.text, /warning/);
  assert.match(status.tooltip, /generate/);
});
