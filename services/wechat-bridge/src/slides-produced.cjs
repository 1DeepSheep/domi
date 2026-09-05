const fs = require("node:fs");
const path = require("node:path");
const { slideElementsIn } = require("./slides-html-contract.cjs");

// Last-resort delivery guard for a Skill that did not declare its output type.
// Existing deck downloads do not start an authoring workflow.
function producedSlides(paths, since) {
  const start = typeof since === "number" ? since : Date.parse(since);
  if (!Number.isFinite(start) || start <= 0) return false;
  return paths.some((file) => {
    try {
      const extension = path.extname(file).toLowerCase();
      if (![".html", ".htm", ".pptx"].includes(extension)) return false;
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mtimeMs < start || stat.size > 32 * 1024 * 1024) return false;
      return extension === ".pptx" || slideElementsIn(fs.readFileSync(file, "utf8")).length > 0;
    } catch { return false; }
  });
}
module.exports = { producedSlides };
