import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingPlaudContinuation,
  plaudContinuationPrompt
} from "../src/plaud-continuation.ts";

const pendingItem = {
  fileId: "file-1",
  fileName: "2026-08-14 13:07:22",
  queueStage: "context_pending",
  transcriptPath: "/work/existing-transcript.md"
};

test("PLAUD context replies resume the isolated execution owned by the same task", () => {
  assert.deepEqual(
    pendingPlaudContinuation({
      projectId: "domi-project-project-1",
      plaudFileId: "file-1",
      title: "2026-08-14 13:07:22 纪要",
      messages: [{
        role: "assistant",
        workflowId: "domi-router",
        status: "done",
        content: "请补充访谈类型和参会人。",
        entityExecutionIsolated: true,
        executionCodexThreadId: "codex-isolated-1"
      }]
    }, [pendingItem]),
    { item: pendingItem, executionCodexThreadId: "codex-isolated-1" }
  );
});

test("older tasks recover the pending recording from their original workflow launch", () => {
  assert.equal(
    pendingPlaudContinuation({
      projectId: "domi-project-project-1",
      title: "2026-08-14 13:07:22 纪要",
      messages: [{
        role: "user",
        workflowId: "domi-router",
        content: "启动「处理录音」：生成“2026-08-14 13:07:22”的纪要并按 domi 工作流入库"
      }]
    }, [pendingItem])?.item.fileId,
    "file-1"
  );
});

test("continuation matching fails closed for completed or ambiguous recordings", () => {
  assert.equal(
    pendingPlaudContinuation({ plaudFileId: "file-1" }, [{ ...pendingItem, queueStage: "managed" }]),
    null
  );
  assert.equal(
    pendingPlaudContinuation({
      title: "同名录音 纪要",
      messages: [{
        role: "user",
        workflowId: "domi-router",
        content: "启动「处理录音」：生成“同名录音”的纪要并按 domi 工作流入库"
      }]
    }, [
      { ...pendingItem, fileId: "a", fileName: "同名录音" },
      { ...pendingItem, fileId: "b", fileName: "同名录音" }
    ]),
    null
  );
});

test("continuation prompt preserves the answer and forbids starting another recording", () => {
  const prompt = plaudContinuationPrompt(
    "只处理 file-1，复用 /work/existing-transcript.md。",
    "管理层访谈，参会人：项目方戴君、投资方郑光辉"
  );
  assert.match(prompt, /管理层访谈/);
  assert.match(prompt, /标记 context_ready 后直接继续/);
  assert.match(prompt, /不得启动麦克风/);
  assert.match(prompt, /不得重新生成或下载已有文字稿/);
});
