import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_SLIDES_FILES,
  verifyDomiInvestmentSlidesContract,
} from "../src/slides-contract.js";

function fixture(t, { enabled = true, complete = true } = {}) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-contract-"));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const configDir = path.join(homeDir, ".codex");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.toml"),
    `[plugins."domi@domi-managed"]\nenabled = ${enabled}\n`,
  );
  const pluginRoot = path.join(
    homeDir,
    "Library",
    "Application Support",
    "domi",
    "runtime",
    "domi-marketplace",
    "plugins",
    "domi",
  );
  if (complete) {
    for (const segments of REQUIRED_SLIDES_FILES) {
      const target = path.join(pluginRoot, ...segments);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        segments.at(-1) === "investment-banking-slides.md"
          ? "Morgan Stanley\nHTML + PDF\n"
          : "fixture\n",
      );
    }
  }
  return { homeDir, pluginRoot };
}

test("Slides contract accepts an enabled complete domi-managed plugin", (t) => {
  const { homeDir, pluginRoot } = fixture(t);
  assert.deepEqual(
    verifyDomiInvestmentSlidesContract({ homeDir, environment: {} }),
    { ok: true, root: pluginRoot, error: "" },
  );
});

test("Slides contract fails closed when domi-managed is disabled", (t) => {
  const { homeDir } = fixture(t, { enabled: false });
  const result = verifyDomiInvestmentSlidesContract({ homeDir, environment: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /未启用/);
});

test("Slides contract fails closed when the Morgan Stanley assets are missing", (t) => {
  const { homeDir } = fixture(t, { complete: false });
  const result = verifyDomiInvestmentSlidesContract({ homeDir, environment: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /缺少 investment-analysis/);
});
