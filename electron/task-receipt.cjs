const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function localTaskReceipt(document, content, ledger) {
  const documentSha256 = sha256(content);
  const ledgerSha256 = sha256(stableJson(ledger));
  let syncReceipt;
  try {
    const receiptPath = path.join(path.dirname(document), ".domi-todo-last-run.json");
    const stat = fs.lstatSync(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error("invalid receipt");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const actualIds = ledger.tasks.map((task) => task.id).sort();
    if ((receipt.schema === "domi.todo-result.v1" || receipt.contractVersion === "DOMI_TODO_RESULT_V1")
      && receipt.verified === true && typeof receipt.runId === "string" && receipt.runId
      && receipt.documentSha256 === documentSha256
      && receipt.ledgerSha256 === ledgerSha256
      && Array.isArray(receipt.taskIds)
      && JSON.stringify([...receipt.taskIds].sort()) === JSON.stringify(actualIds)) {
      syncReceipt = receipt;
    }
  } catch {
    // A missing/stale receipt never prevents reading the user's actual ledger.
  }
  return { documentSha256, ledgerSha256, ...(syncReceipt ? { syncReceipt } : {}) };
}

module.exports = { localTaskReceipt, sha256, stableJson };
