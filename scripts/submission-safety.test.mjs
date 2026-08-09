import assert from "node:assert/strict";
import test from "node:test";
import {
  codexThreadOwnerIds,
  isThreadSubmissionBusy,
  quarantineDuplicateCodexThreadOwnership,
  reconcileCommittedAttachmentPaths,
  recoveryCodexThreadId,
  resumableCodexThreadId
} from "../src/submission-safety.ts";

const attachment = (path, name = path.split("/").pop()) => ({ path, name, size: 1 });

test("committed staging paths are reconciled without overwriting newer draft edits", () => {
  const staged = attachment("/staging/old.pdf", "old.pdf");
  const committed = attachment("/project/materials/old.pdf", "old.pdf");
  const newlyAdded = attachment("/staging/new.png", "new.png");
  const current = [staged, newlyAdded];

  const result = reconcileCommittedAttachmentPaths(current, [staged], [committed]);

  assert.deepEqual(result, [committed, newlyAdded]);
  assert.equal(result[1], newlyAdded);
});

test("an unrelated or already removed staging attachment leaves the draft untouched", () => {
  const staged = attachment("/staging/old.pdf", "old.pdf");
  const committed = attachment("/project/materials/old.pdf", "old.pdf");
  const current = [attachment("/staging/new.png", "new.png")];

  const result = reconcileCommittedAttachmentPaths(current, [staged], [committed]);

  assert.equal(result, current);
});

test("a thread is deletion-busy during foreground preflight or queue pump startup", () => {
  assert.equal(isThreadSubmissionBusy("a", "run-a", new Set(), new Set()), true);
  assert.equal(isThreadSubmissionBusy("a", undefined, new Set(["a"]), new Set()), true);
  assert.equal(isThreadSubmissionBusy("a", undefined, new Set(), new Set(["a"])), true);
  assert.equal(isThreadSubmissionBusy("a", undefined, new Set(), new Set(), new Set(["a"])), true);
  assert.equal(isThreadSubmissionBusy("a", undefined, new Set(["b"]), new Set(["c"])), false);
});

test("only the sole local owner may resume a canonical Codex conversation", () => {
  const unique = [{ id: "a", codexThreadId: "remote-1" }];
  assert.equal(resumableCodexThreadId(unique, "a", "remote-1", false), "remote-1");
  assert.equal(resumableCodexThreadId(unique, "a", "remote-1", true), undefined);

  const duplicated = [
    { id: "a", codexThreadId: "remote-1" },
    { id: "b", codexThreadId: "remote-1" }
  ];
  assert.equal(resumableCodexThreadId(duplicated, "a", "remote-1", false), undefined);
});

test("duplicate canonical owners are all quarantined before either can resume", () => {
  const original = [
    { id: "a", codexThreadId: "polluted" },
    { id: "b", codexThreadId: "polluted" },
    { id: "c", codexThreadId: "safe" }
  ];
  const result = quarantineDuplicateCodexThreadOwnership(original, "polluted");

  assert.deepEqual(result.quarantinedThreadIds, ["a", "b"]);
  assert.equal(result.threads[0].codexThreadId, undefined);
  assert.equal(result.threads[1].codexThreadId, undefined);
  assert.deepEqual(result.threads[0].quarantinedCodexThreadIds, ["polluted"]);
  assert.deepEqual(result.threads[1].quarantinedCodexThreadIds, ["polluted"]);
  assert.equal(result.threads[2].codexThreadId, "safe");
  assert.equal(original[0].codexThreadId, "polluted");
  assert.equal(resumableCodexThreadId(result.threads, "b", "polluted", false), undefined);
  assert.equal(
    resumableCodexThreadId(
      [{ id: "a", codexThreadId: "polluted", quarantinedCodexThreadIds: ["polluted"] }],
      "a",
      "polluted",
      false
    ),
    undefined
  );
});

test("canonical and isolated execution owners cannot share a Codex conversation", () => {
  const original = [
    { id: "canonical", codexThreadId: "remote-shared", messages: [] },
    {
      id: "isolated",
      messages: [{ executionCodexThreadId: "remote-shared" }]
    }
  ];

  assert.equal(
    resumableCodexThreadId(original, "canonical", "remote-shared", false),
    undefined
  );
  const result = quarantineDuplicateCodexThreadOwnership(original, "remote-shared");
  assert.deepEqual(result.quarantinedThreadIds, ["canonical", "isolated"]);
  assert.equal(result.threads[0].codexThreadId, undefined);
  assert.deepEqual(result.threads[1].quarantinedCodexThreadIds, ["remote-shared"]);
  assert.deepEqual(codexThreadOwnerIds(original, "remote-shared"), ["canonical", "isolated"]);
});

test("isolated recovery never falls back to the source task Codex conversation", () => {
  assert.equal(recoveryCodexThreadId("source", undefined, true), undefined);
  assert.equal(recoveryCodexThreadId("source", "isolated", true), "isolated");
  assert.equal(recoveryCodexThreadId("source", undefined, false), "source");
});
