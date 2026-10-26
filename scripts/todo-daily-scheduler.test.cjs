"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TodoDailyScheduler, LEASE_MS, RETRY_DELAYS_MS } = require("../electron/todo-daily-scheduler.cjs");

const repositoryIdentity = "local:/private/example/investment-library";
const secondIdentity = "local:/private/example/second-library";
const time = (day, hour = 9, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

function fixture(t, initialTime = time(26)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-todo-schedule-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "todo-daily-schedule.json");
  let now = initialTime;
  const create = () => new TodoDailyScheduler({ filePath, now: () => now });
  return { directory, filePath, create, service: create(), setTime: value => { now = value; } };
}

test("09:00 is the daily boundary and opening later catches up without creating a duplicate run", t => {
  const f = fixture(t, time(26, 8, 59));
  assert.equal(f.service.status({ repositoryIdentity }).state, "scheduled");
  assert.equal(f.service.claim({ repositoryIdentity }).claimed, false);
  assert.equal(fs.existsSync(f.filePath), false);
  f.setTime(time(26, 13));
  const claimed = f.service.claim({ repositoryIdentity });
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.localDay, "2026-10-26");
  assert.equal(f.service.claim({ repositoryIdentity }).reason, "running");
  assert.equal(f.service.claim({ repositoryIdentity, trigger: "manual" }).claimed, false);
});

test("verified success persists across restart and next day becomes eligible at 09:00", t => {
  const f = fixture(t);
  const { token } = f.service.claim({ repositoryIdentity });
  f.setTime(time(26, 9, 3));
  const finished = f.service.finish({ repositoryIdentity, token, success: true });
  assert.equal(finished.accepted, true);
  assert.equal(finished.state, "completed");
  assert.equal(finished.lastSuccessAt, time(26, 9, 3));
  assert.equal(f.create().claim({ repositoryIdentity }).reason, "completed");
  f.setTime(time(27, 8));
  assert.equal(f.create().status({ repositoryIdentity }).state, "scheduled");
  f.setTime(time(27));
  const tomorrow = f.create().claim({ repositoryIdentity });
  assert.equal(tomorrow.claimed, true);
  assert.equal(tomorrow.attempts, 1);
  assert.equal(tomorrow.localDay, "2026-10-27");
});

test("manual update before 09:00 counts for the same day and later manual refresh remains available", t => {
  const f = fixture(t, time(26, 7));
  const { token } = f.service.claim({ repositoryIdentity, trigger: "manual" });
  assert.ok(token);
  assert.equal(f.service.finish({ repositoryIdentity, token, success: true }).state, "completed");
  f.setTime(time(26, 9));
  assert.equal(f.service.claim({ repositoryIdentity }).claimed, false);
  const manual = f.service.claim({ repositoryIdentity, trigger: "manual" });
  assert.equal(manual.claimed, true);
  assert.equal(manual.attempts, 0);
  assert.equal(f.service.finish({ repositoryIdentity, token: manual.token, success: false }).state, "completed");
});

test("failures retry with bounded backoff and stop automatically after three attempts", t => {
  const f = fixture(t);
  let lastSuccessAt = null;
  for (let index = 0; index < 3; index += 1) {
    const run = f.service.claim({ repositoryIdentity });
    assert.equal(run.claimed, true);
    assert.equal(run.attempts, index + 1);
    const finished = f.service.finish({ repositoryIdentity, token: run.token, success: false });
    assert.equal(finished.lastSuccessAt, lastSuccessAt);
    assert.equal(f.service.claim({ repositoryIdentity }).claimed, false);
    if (index < 2) {
      assert.equal(finished.state, "retrying");
      assert.equal(finished.nextRunAt, run.lastAttemptAt + RETRY_DELAYS_MS[index]);
      f.setTime(finished.nextRunAt);
    } else {
      assert.equal(finished.state, "exhausted");
      assert.equal(finished.nextRunAt, time(27));
    }
  }
  const manual = f.service.claim({ repositoryIdentity, trigger: "manual" });
  assert.equal(manual.claimed, true);
  assert.equal(f.service.finish({ repositoryIdentity, token: manual.token, success: true }).state, "completed");
});

test("a saved lease blocks renderer reloads and expires safely after a crash", t => {
  const f = fixture(t);
  const first = f.service.claim({ repositoryIdentity });
  assert.equal(f.create().claim({ repositoryIdentity }).claimed, false);
  f.setTime(time(26) + LEASE_MS);
  const expired = f.create().status({ repositoryIdentity });
  assert.equal(expired.state, "retrying");
  assert.equal(expired.lastSuccessAt, null);
  assert.equal(expired.nextRunAt, time(26) + LEASE_MS + RETRY_DELAYS_MS[0]);
  f.setTime(expired.nextRunAt);
  const second = f.create().claim({ repositoryIdentity });
  assert.equal(second.claimed, true);
  assert.notEqual(first.token, second.token);
  assert.equal(second.attempts, 2);
  assert.equal(f.service.finish({ repositoryIdentity, token: first.token, success: true }).accepted, false);
  assert.equal(f.create().status({ repositoryIdentity }).running, true);
  assert.equal(f.service.finish({ repositoryIdentity, token: second.token, success: true }).accepted, true);
});

test("an expired lease found hours later can retry immediately instead of adding another delay", t => {
  const f = fixture(t);
  f.service.claim({ repositoryIdentity });
  f.setTime(time(26, 14));
  const resumed = f.create().claim({ repositoryIdentity });
  assert.equal(resumed.claimed, true);
  assert.equal(resumed.attempts, 2);
});

test("switching repositories cannot overlap runs and each repository keeps its own daily success", t => {
  const f = fixture(t);
  const first = f.service.claim({ repositoryIdentity });
  const other = f.service.claim({ repositoryIdentity: secondIdentity });
  assert.equal(other.claimed, false);
  assert.equal(other.runningForRepository, false);
  assert.equal(f.service.finish({ repositoryIdentity: secondIdentity, token: first.token, success: true }).accepted, false);
  f.service.finish({ repositoryIdentity, token: first.token, success: true });
  const second = f.service.claim({ repositoryIdentity: secondIdentity });
  assert.equal(second.claimed, true);
  f.service.finish({ repositoryIdentity: secondIdentity, token: second.token, success: true });
  assert.equal(f.service.status({ repositoryIdentity }).state, "completed");
  assert.equal(f.service.status({ repositoryIdentity: secondIdentity }).state, "completed");
});

test("midnight crossing marks the evaluated day only", t => {
  const f = fixture(t, time(26, 23, 58));
  const first = f.service.claim({ repositoryIdentity });
  f.setTime(time(27, 0, 2));
  const finished = f.service.finish({ repositoryIdentity, token: first.token, success: true });
  assert.equal(finished.accepted, true);
  assert.equal(finished.state, "scheduled");
  assert.equal(finished.nextRunAt, time(27));
  f.setTime(time(27));
  assert.equal(f.service.claim({ repositoryIdentity }).claimed, true);
});

test("temporary clock rollback does not repeat a recently completed day", t => {
  const f = fixture(t);
  for (const day of [26, 27]) {
    f.setTime(time(day));
    const run = f.service.claim({ repositoryIdentity });
    f.service.finish({ repositoryIdentity, token: run.token, success: true });
  }
  f.setTime(time(26, 12));
  assert.equal(f.service.claim({ repositoryIdentity }).reason, "completed");
});

test("checkpoint contains only hashes and coordination data, never raw repository paths", t => {
  const f = fixture(t);
  const run = f.service.claim({ repositoryIdentity });
  f.service.finish({ repositoryIdentity, token: run.token, success: true });
  const text = fs.readFileSync(f.filePath, "utf8");
  assert.equal(text.includes(repositoryIdentity), false);
  assert.equal(text.includes("investment-library"), false);
  assert.equal(fs.statSync(f.filePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(f.directory), ["todo-daily-schedule.json"]);
});

test("damaged schedule fails closed and leaves its contents intact", t => {
  const f = fixture(t);
  fs.writeFileSync(f.filePath, "{broken");
  assert.throws(() => f.service.claim({ repositoryIdentity }), /记录暂时无法读取/);
  assert.equal(fs.readFileSync(f.filePath, "utf8"), "{broken");
});

test("failed atomic write cannot mark a run complete or erase the persisted lease", t => {
  const f = fixture(t);
  const run = f.service.claim({ repositoryIdentity });
  const before = fs.readFileSync(f.filePath, "utf8");
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (target === f.filePath) throw Object.assign(new Error("disk temporarily unavailable"), { code: "EIO" });
    return rename(source, target);
  };
  try {
    assert.throws(() => f.service.finish({ repositoryIdentity, token: run.token, success: true }), /disk temporarily unavailable/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(fs.readFileSync(f.filePath, "utf8"), before);
  assert.equal(f.create().status({ repositoryIdentity }).running, true);
  assert.equal(f.service.finish({ repositoryIdentity, token: run.token, success: true }).accepted, true);
  assert.deepEqual(fs.readdirSync(f.directory), ["todo-daily-schedule.json"]);
});

test("invalid request cannot claim or finish and does not create state", t => {
  const f = fixture(t);
  assert.throws(() => f.service.claim({ repositoryIdentity: "" }), /资料库标识/);
  assert.throws(() => f.service.claim({ repositoryIdentity, trigger: "unknown" }), /触发方式/);
  assert.throws(() => f.service.finish({ repositoryIdentity, token: "token", success: "true" }), /经过验证/);
  assert.equal(fs.existsSync(f.filePath), false);
});

test("local scheduling uses wall clock 09:00 across daylight saving transitions", t => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const initial = new Date(2026, 9, 31, 9).getTime();
    const f = fixture(t, initial);
    const run = f.service.claim({ repositoryIdentity });
    const finished = f.service.finish({ repositoryIdentity, token: run.token, success: true });
    assert.equal(new Date(finished.nextRunAt).getHours(), 9);
    assert.equal(finished.nextRunAt - initial, 25 * 60 * 60 * 1000);
    f.setTime(finished.nextRunAt);
    assert.equal(f.service.claim({ repositoryIdentity }).claimed, true);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
