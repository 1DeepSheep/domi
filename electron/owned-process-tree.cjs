const { execFileSync } = require('node:child_process');

function processSnapshot() {
  // No command lines: MCP arguments may contain credentials.
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  const rows = new Map();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (match) rows.set(Number(match[1]), { parent: Number(match[2]), birth: match[3] });
  }
  return rows;
}
function captureOwnedTree(pid) {
  if (!pid || process.platform === 'win32') return new Map();
  try {
    const rows = processSnapshot();
    const owned = new Map();
    if (rows.has(pid)) owned.set(pid, rows.get(pid));
    for (let changed = true; changed;) {
      changed = false;
      for (const [id, row] of rows) {
        if (!owned.has(id) && owned.has(row.parent)) { owned.set(id, row); changed = true; }
      }
    }
    return owned;
  } catch { return new Map(); }
}
function signalOwnedTree(owned, signal) {
  if (!owned.size) return;
  let current;
  try { current = processSnapshot(); } catch { return; }
  // Birth identity prevents signalling a PID recycled since the snapshot.
  for (const [pid, row] of [...owned].reverse()) {
    if (pid === process.pid || current.get(pid)?.birth !== row.birth) continue;
    try { process.kill(pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
module.exports = { captureOwnedTree, signalOwnedTree };
