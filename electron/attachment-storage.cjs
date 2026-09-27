const fs = require("node:fs");
const path = require("node:path");

// Import identifiers belong in temporary parent directories, never in the
// user's filename: a downstream archive may legitimately copy basename(path).
async function writeNamedAttachment({ directory, name, staging = false, write }) {
  if (!name || path.basename(name) !== name || /[\\/\0]/u.test(name) || [".", ".."].includes(name)) {
    throw new Error("附件名称无效。");
  }
  const parent = staging ? await fs.promises.mkdtemp(path.join(directory, "import-")) : directory;
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  try {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = attempt === 0 ? name : `${stem} (${attempt + 1})${extension}`;
      const target = path.join(parent, candidate);
      try {
        // Each caller must use exclusive creation. Never replace an existing
        // material, including symlinks or two simultaneous imports of one name.
        await write(target);
        return target;
      } catch (error) {
        if (error?.code !== "EEXIST" || staging) throw error;
      }
    }
    throw new Error("同名附件过多，请调整文件名后重试。");
  } catch (error) {
    if (staging) await fs.promises.rmdir(parent).catch(() => undefined);
    throw error;
  }
}

async function removeEmptyAttachmentImportDirectory(filePath) {
  const parent = path.dirname(filePath);
  if (path.basename(path.dirname(parent)) === "attachments" && /^import-[A-Za-z0-9]{6}$/u.test(path.basename(parent))) {
    // Non-recursive: a concurrent or unexpected file must never be deleted.
    await fs.promises.rmdir(parent).catch(() => undefined);
  }
}

module.exports = { writeNamedAttachment, removeEmptyAttachmentImportDirectory };
