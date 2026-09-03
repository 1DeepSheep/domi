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
          ? "Morgan Stanley\nHTML + PDF\nnode qa_deck.js deck.html --strict\n"
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
  assert.match(result.error, /缺少独立 slides Skill/);
});

test("Slides contract requires the full standalone templates, recipes and audit toolchain", (t) => {
  const { homeDir, pluginRoot } = fixture(t);
  const requiredRelativePaths = REQUIRED_SLIDES_FILES.map((segments) => segments.join("/"));
  for (const expected of [
    "skills/slides/references/morgan-stanley-ibd-template-notes.md",
    "skills/slides/assets/slides/base-deck.html",
    "skills/slides/assets/slides/ms-research.css",
    "skills/slides/assets/slides/page-templates.html",
    "skills/slides/assets/slides/style-packs/morgan-stanley/layout-index.json",
    "skills/slides/assets/slides/style-packs/morgan-stanley/layout-recipes.md",
    "skills/slides/assets/slides/style-packs/morgan-stanley/chart-recipes.md",
    "skills/slides/scripts/audit_research_deck.js",
  ]) {
    assert.ok(requiredRelativePaths.includes(expected), `missing contract entry: ${expected}`);
  }

  fs.rmSync(path.join(
    pluginRoot,
    "skills",
    "slides",
    "assets",
    "slides",
    "style-packs",
    "morgan-stanley",
    "chart-recipes.md",
  ));
  const result = verifyDomiInvestmentSlidesContract({ homeDir, environment: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /缺少独立 slides Skill/);
});
