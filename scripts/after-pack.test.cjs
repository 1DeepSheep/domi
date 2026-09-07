const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { cleanSigningMetadata } = require("./after-pack.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-signing-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "Fixture.app"), executable = path.join(app, "Contents/MacOS/Fixture");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  return { root, app, executable };
}

const macOnly = { skip: process.platform !== "darwin" ? "macOS xattr and codesign contract" : false };
test("staged Finder metadata reproduces codesign failure; targeted cleanup restores signing", macOnly, t => {
  const f = fixture(t);
  fs.copyFileSync("/usr/bin/true", f.executable);
  fs.writeFileSync(path.join(f.app, "Contents/Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleIdentifier</key><string>test.domi.fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  execFileSync("/usr/bin/xattr", ["-wx", "com.apple.FinderInfo", "01".padEnd(64, "0"), f.app]);
  execFileSync("/usr/bin/xattr", ["-w", "com.apple.ResourceFork", "synthetic fork", f.executable]);
  execFileSync("/usr/bin/xattr", ["-w", "com.apple.quarantine", "0081;0;domi-contract;", f.executable]);
  execFileSync("/usr/bin/xattr", ["-w", "com.domi.preserved", "retain", f.app]);
  const signArgs = ["--force", "--sign", "-", "--timestamp=none", f.app];
  const before = spawnSync("/usr/bin/codesign", signArgs, { encoding: "utf8" });
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /resource fork, Finder information, or similar detritus/);
  cleanSigningMetadata(f.app, f.root);
  cleanSigningMetadata(f.app, f.root);
  assert.equal(execFileSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", f.executable], { encoding: "utf8" }).trim(), "0081;0;domi-contract;");
  assert.equal(execFileSync("/usr/bin/xattr", ["-p", "com.domi.preserved", f.app], { encoding: "utf8" }).trim(), "retain");
  execFileSync("/usr/bin/codesign", signArgs, { stdio: "pipe" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", f.app], { stdio: "pipe" });
});

test("cleanup does not follow resource symlinks or accept an app outside the build root", macOnly, t => {
  const f = fixture(t), outside = path.join(f.root, "outside");
  fs.writeFileSync(outside, "preserve this synthetic source");
  execFileSync("/usr/bin/xattr", ["-wx", "com.apple.FinderInfo", "01".padEnd(64, "0"), outside]);
  fs.symlinkSync(outside, path.join(f.app, "external-resource"));
  cleanSigningMetadata(f.app, f.root);
  assert.equal(execFileSync("/usr/bin/xattr", ["-px", "com.apple.FinderInfo", outside], { encoding: "utf8" }).replace(/\s/g, ""), "01".padEnd(64, "0"));
  const linkedApp = path.join(f.root, "Linked.app"); fs.symlinkSync(f.app, linkedApp);
  assert.throws(() => cleanSigningMetadata(linkedApp, f.root), /staged/);
  assert.throws(() => cleanSigningMetadata(f.app, path.dirname(f.root)), /staged/);
});
