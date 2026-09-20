const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { INSTALLATION_MARKER, maybeInstallApplication } = require("../electron/application-installation.cjs");

function fixture(t, changes = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-installation-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = { prompts: [], moves: [], events: [] };
  const app = {
    isPackaged: true,
    isInApplicationsFolder: () => false,
    getPath: (name) => { assert.equal(name, "userData"); return directory; },
    moveToApplicationsFolder: (options) => { calls.moves.push(options); return true; },
    quit: () => assert.fail("native relocation owns quitting"),
    relaunch: () => assert.fail("native relocation owns relaunching"),
    ...changes.app
  };
  const options = {
    app,
    platform: "darwin",
    dialog: {
      showMessageBox: async (request) => { calls.prompts.push(request); return { response: 0 }; }
    },
    isSafeToInstall: () => true,
    onEvent: (status, detail) => calls.events.push({ status, detail }),
    ...changes,
    app
  };
  return { options, calls, directory, run: () => maybeInstallApplication(options) };
}

test("packaged copy outside Applications moves only after consent and stops old startup", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.run(), { continueStartup: false, status: "moving" });
  assert.equal(f.calls.moves.length, 1);
  assert.equal(f.calls.prompts.length, 1);
  assert.deepEqual(f.calls.prompts[0].buttons, ["安装并打开", "继续使用"]);
  assert.equal(f.calls.prompts[0].cancelId, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory, INSTALLATION_MARKER))),
    { schemaVersion: 1, prompted: true });
});

test("development, non-macOS and installed builds never show the guide or write a marker", async (t) => {
  for (const changes of [
    { app: { isPackaged: false } },
    { platform: "win32" },
    { platform: "linux" },
    { app: { isInApplicationsFolder: () => true } }
  ]) {
    const f = fixture(t, changes);
    assert.equal((await f.run()).continueStartup, true);
    assert.equal(f.calls.prompts.length, 0);
    assert.equal(f.calls.moves.length, 0);
    assert.deepEqual(fs.readdirSync(f.directory), []);
  }
});

test("missing APIs and location failures preserve normal startup", async (t) => {
  for (const app of [
    { isInApplicationsFolder: undefined },
    { moveToApplicationsFolder: undefined },
    { isInApplicationsFolder: () => { throw new Error("synthetic location failure"); } }
  ]) {
    const f = fixture(t, { app });
    assert.equal((await f.run()).continueStartup, true);
    assert.equal(f.calls.prompts.length, 0);
  }
});

test("active work, missing safety guard and failing guard do not attempt installation", async (t) => {
  for (const isSafeToInstall of [undefined, () => false, () => { throw new Error("unknown state"); }]) {
    const f = fixture(t, { isSafeToInstall });
    assert.equal((await f.run()).status, "unsafe-to-install");
    assert.equal(f.calls.prompts.length, 0);
    assert.equal(f.calls.moves.length, 0);
    assert.deepEqual(fs.readdirSync(f.directory), []);
  }
});

test("new work while the prompt is open prevents relocation", async (t) => {
  let safe = true;
  const f = fixture(t, { isSafeToInstall: () => safe });
  f.options.dialog.showMessageBox = async () => { safe = false; return { response: 0 }; };
  assert.equal((await f.run()).status, "unsafe-to-install");
  assert.equal(f.calls.moves.length, 0);
});

test("decline survives another process and version without re-prompting", async (t) => {
  const f = fixture(t);
  f.options.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal((await f.run()).status, "declined");
  assert.equal(f.calls.moves.length, 0);
  assert.equal((await maybeInstallApplication({ ...f.options, app: { ...f.options.app } })).status,
    "already-prompted");
  assert.equal(f.calls.moves.length, 0);
});

test("concurrent and repeated startup calls share one prompt and relocation", async (t) => {
  const f = fixture(t);
  let resolveChoice;
  f.options.dialog.showMessageBox = (request) => {
    f.calls.prompts.push(request);
    return new Promise((resolve) => { resolveChoice = resolve; });
  };
  const one = f.run();
  const two = f.run();
  assert.equal(one, two);
  resolveChoice({ response: 0 });
  await Promise.all([one, two, f.run()]);
  assert.equal(f.calls.moves.length, 1);
  assert.equal(f.calls.prompts.length, 1);
});

test("existing and running versions are never replaced or forcibly activated", async (t) => {
  for (const conflict of ["exists", "existsAndRunning", "unknown"]) {
    const f = fixture(t);
    f.options.app.moveToApplicationsFolder = ({ conflictHandler }) => {
      assert.equal(conflictHandler(conflict), false);
      return false;
    };
    const result = await f.run();
    assert.equal(result.continueStartup, true);
    assert.equal(result.status, conflict === "existsAndRunning" ? "existing-app-running" : "existing-app");
    assert.equal(f.calls.prompts.length, 2);
    assert.match(f.calls.prompts[1].detail, /没有替换/);
    assert.equal((await maybeInstallApplication({ ...f.options, app: { ...f.options.app } })).status,
      "already-prompted");
  }
});

test("canceled native authorization continues without an error dialog or retry", async (t) => {
  const f = fixture(t, { app: { moveToApplicationsFolder: () => false } });
  assert.deepEqual(await f.run(), { continueStartup: true, status: "move-canceled" });
  assert.equal(f.calls.prompts.length, 1);
});

test("permission and copy failures produce one useful notice and allow startup", async (t) => {
  for (const code of ["EACCES", "EPERM", "ENOSPC"]) {
    const f = fixture(t, { app: {
      moveToApplicationsFolder: () => { throw Object.assign(new Error("synthetic"), { code }); }
    } });
    assert.deepEqual(await f.run(), { continueStartup: true, status: "move-failed" });
    assert.equal(f.calls.prompts.length, 2);
    assert.deepEqual(f.calls.events, [{ status: "move-failed", detail: { code } }]);
    assert.equal((await maybeInstallApplication({ ...f.options, app: { ...f.options.app } })).status,
      "already-prompted");
  }
});

test("unwritable markers skip the guide rather than nagging on every launch", async (t) => {
  const f = fixture(t, { fileSystem: {
    mkdirSync: () => {},
    writeFileSync: () => { throw Object.assign(new Error("synthetic"), { code: "EACCES" }); }
  } });
  assert.equal((await f.run()).status, "marker-unavailable");
  assert.equal(f.calls.prompts.length, 0);
  assert.equal(f.calls.moves.length, 0);
});

test("an empty or corrupted marker still suppresses repeated prompting", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, INSTALLATION_MARKER), "");
  assert.equal((await f.run()).status, "already-prompted");
  assert.equal(f.calls.prompts.length, 0);
});

test("dialog and diagnostic failures cannot crash normal startup", async (t) => {
  const f = fixture(t, { onEvent: () => { throw new Error("synthetic logger failure"); } });
  f.options.dialog.showMessageBox = async () => { throw new Error("synthetic dialog failure"); };
  assert.deepEqual(await f.run(), { continueStartup: true, status: "prompt-failed" });
  assert.equal(f.calls.moves.length, 0);
  assert.equal((await maybeInstallApplication({ ...f.options, app: { ...f.options.app } })).status,
    "already-prompted");
});

test("a failed error notice cannot turn a move failure into an unhandled rejection", async (t) => {
  const f = fixture(t, { app: { moveToApplicationsFolder: () => { throw new Error("synthetic"); } } });
  let prompts = 0;
  f.options.dialog.showMessageBox = async () => {
    if (prompts++ === 0) return { response: 0 };
    throw new Error("synthetic notice failure");
  };
  assert.deepEqual(await f.run(), { continueStartup: true, status: "move-failed" });
  assert.equal(prompts, 2);
});
