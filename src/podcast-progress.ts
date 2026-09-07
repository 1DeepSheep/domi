import type { PodcastJob, PodcastProgressRequest, RadarSource, RadarSourceSnapshot } from "./env.d.ts";

export function podcastWorkflowContract(job: PodcastJob, executionRunId: string): string {
  const manifestPath = job.archive?.manifestPath;
  if (!manifestPath) throw new Error("播客进度缺少稳定 manifest 路径，已保留文字稿等待恢复。");
  const archiveReceiptPath = manifestPath.replace(/[^\\/]+$/, "archive-receipt.json");
  return [
    `DOMI_PODCAST_RUN_V1 runId=${executionRunId} jobId=${job.id}`,
    "workflow=podcast-ingestion",
    `workflowRunId=podcast:${job.id}`,
    `executionRunId=${executionRunId}`,
    `workflowManifestPath=${manifestPath}`,
    `archiveReceiptPath=${archiveReceiptPath}`,
    `resumeStage=${job.archive?.stage}`,
    job.archive?.notesPath ? `verifiedNotesPath=${job.archive.notesPath}` : "",
    job.archive?.qaReceiptPath ? `verifiedQaReceiptPath=${job.archive.qaReceiptPath}` : "",
    "用插件 scripts/domi-workflow.cjs 在这个稳定 manifest 记录阶段。存在时先 inspect --manifest <workflowManifestPath>，核验真实产物；首次不存在则按完整阶段合同用 save --manifest <workflowManifestPath> --input <save-input.json> 创建，save-input 为 {expectedHash:null,manifest:完整domi.handoff.v1对象}。后续 save 使用最近 inspect/save 返回的 manifestSha256 作为 expectedHash。",
    "已通过且哈希一致的完整纪要/QA必须复用，只继续未完成阶段，禁止重新下载、转写或无故重做纪要。原有模型、证据、完整性和语义编辑质量门全部保留。",
    "重试时 inspect 通过后运行 rebind --manifest <workflowManifestPath> --execution-run-id <executionRunId> --expected-hash <inspect返回的manifestSha256>；稳定 workflowRunId 不变，只更新当前执行ID。若 inspect 明确指出产物或规则失效，先按程序工具合同 invalidate 受影响阶段并保留历史，重新核验该阶段后再继续；不得更改原授权范围。",
    "纪要阶段沿用 ASR Skill 的完整 asr.evidence-index.v1 与 asr.qa-receipt.v1，执行 evidence-check --index <真实证据索引路径> --qa <真实QA路径>；在 manifest 保存已完成 notes 阶段及其 transcript、notes、evidence_index、qa_receipt 真实产物，不自行构造简化 passed。",
    `完整纪要与 QA 实际落盘并校验后输出 <!-- DOMI_PODCAST_PROGRESS_V1 {"jobId":"${job.id}","runId":"${executionRunId}","stage":"notes_ready","notesPath":"实际完整纪要路径","qaReceiptPath":"实际QA回执路径"} -->，用于程序验证检查点。`,
    "唯一主归档完成后使用 domi-workflow.cjs finalize --manifest <workflowManifestPath> --receipt <archiveReceiptPath>，必须使用上方固定绝对回执路径；返回 domi.storage-receipt.v1 的 workflowRunId/executionRunId 必须与本轮合同一致，canonicalDocumentId 必须绑定当前单集，不得只用文件存在或自己写 passed 代替。",
    `最终输出 <!-- DOMI_PODCAST_PROGRESS_V1 {"jobId":"${job.id}","runId":"${executionRunId}","stage":"archived","receiptPath":"finalize返回的真实receiptPath"} -->。程序会检查回执、文档、QA和文件哈希；无法消解的分类冲突保留检查点，不得伪造完成。`
  ].filter(Boolean).join("\n");
}

export function podcastCanResume(job: PodcastJob, source: RadarSource | undefined, now: number, durableResume = true) {
  if (!source?.enabled || !source.autoProcess || job.status === "skipped"
    || job.archive?.status === "archived" || Number(job.archive?.nextRetryAt) > now) return false;
  if (durableResume && job.transcriptPath && ["transcript_ready", "failed"].includes(job.status)) return true;
  if (job.status !== "discovered") return false;
  if (!source.keywords.length) return true;
  const text = `${job.title} ${job.description}`.toLocaleLowerCase("zh-CN");
  return source.keywords.some((keyword) => text.includes(keyword.toLocaleLowerCase("zh-CN")));
}

export function podcastAutomationJob(snapshot: RadarSourceSnapshot, now: number, durableResume: boolean, discoveryReliable: boolean) {
  const sources = new Map(snapshot.sources.map((source) => [source.id, source] as const));
  return snapshot.jobs.filter((job) => {
    const source = sources.get(job.sourceId);
    // A failed RSS refresh says nothing about an already durable transcript.
    // Fresh downloads still require a successfully checked source.
    if (!job.transcriptPath && (!discoveryReliable || Boolean(source?.error))) return false;
    return podcastCanResume(job, source, now, durableResume);
  }).sort((a, b) => (b.publishedAt || b.discoveredAt) - (a.publishedAt || a.discoveredAt))[0];
}

export function podcastProgressRequests(output: string, jobId: string, runId: string): PodcastProgressRequest[] {
  const requests: PodcastProgressRequest[] = [];
  for (const match of output.matchAll(/<!--\s*DOMI_PODCAST_PROGRESS_V1\s+(\{[\s\S]*?\})\s*-->/g)) {
    try {
      const value = JSON.parse(match[1]);
      if (value.jobId !== jobId || value.runId !== runId) continue;
      if (value.stage === "notes_ready" && typeof value.notesPath === "string" && typeof value.qaReceiptPath === "string") {
        requests.push({ jobId, runId, action: "checkpoint", stage: "notes_ready", notesPath: value.notesPath, qaReceiptPath: value.qaReceiptPath });
      } else if (value.stage === "archived" && typeof value.receiptPath === "string") {
        requests.push({ jobId, runId, action: "complete", stage: "archived", receiptPath: value.receiptPath });
      }
    } catch { /* A partial streamed marker is retried after the next delta. */ }
  }
  return requests;
}
