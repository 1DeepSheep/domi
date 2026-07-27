const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const formerBrand = String.fromCodePoint(0x8c46, 0x7c73);
const publicFiles = [
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "docs/RELEASE.md",
  "index.html",
  "package.json",
  "electron",
  "src"
];

function visit(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath)) {
      visit(path.join(relativePath, entry));
    }
    return;
  }
  const content = fs.readFileSync(absolutePath, "utf8");
  assert.equal(
    content.includes(formerBrand),
    false,
    `${relativePath} still contains the retired display name`
  );
}

assert.equal(packageJson.productName, "domi");
assert.equal(packageJson.build.productName, "domi");
assert.equal(packageJson.build.artifactName, "domi-${version}-${arch}.${ext}");
assert.equal(packageJson.build.appId, "com.domi.workbench");
for (const relativePath of publicFiles) visit(relativePath);

const mainSource = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
assert.match(mainSource, /prepareApplicationBrandPaths\(app\)/);
assert.match(mainSource, /const appName = brandPaths\.appName/);

console.log("domi brand contract tests passed.");
