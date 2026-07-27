const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const app = read("src/App.tsx");
const setupCenter = read("src/SetupCenter.tsx");
const editor = read("src/RichMarkdownEditor.tsx");
const editorBoundary = read("src/MarkdownEditorErrorBoundary.tsx");
const sectionBoundary = read("src/SectionErrorBoundary.tsx");
const main = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const taxonomy = read("src/investmentTaxonomy.ts");
const styles = read("src/styles.css");

assert.match(
  editor,
  /!editor\.isInitialized\s*\|\|\s*editor\.isDestroyed/,
  "Markdown toolbar must not inspect an editor that is initializing or destroyed."
);
assert.match(
  editor,
  /function runEditorCommand/,
  "Markdown toolbar event handlers must use the guarded command runner."
);
assert.match(
  editor,
  /markdown-editor-operation/,
  "Markdown event-handler failures must be reported without escaping to the page."
);
assert.match(
  editorBoundary,
  /retryKey/,
  "Retrying the Markdown editor must mount a fresh editor instance."
);
assert.match(
  editor,
  /TiptapImage[\s\S]*?saveMarkdownImage[\s\S]*?handlePaste/,
  "Markdown image paste must use a real image node and persist clipboard files."
);
assert.match(
  editor,
  /resolveMarkdownImage[\s\S]*?previewUrl/,
  "Relative Markdown images must resolve through the protected local preview protocol."
);

assert.match(
  app,
  /markdownOpenRequestRef/,
  "Markdown reads must be protected by a request generation."
);
assert.match(
  app,
  /requestId !== markdownOpenRequestRef\.current/,
  "Stale Markdown reads must not overwrite the current document."
);
assert.match(
  app,
  /requestId !== markdownSaveRequestRef\.current/,
  "Stale Markdown saves must not mutate the current document."
);
assert.match(
  app,
  /<RichMarkdownEditor[\s\S]*?markdown=\{markdownDraft\}/,
  "Editor remounts must retain text entered while a save was in flight."
);
assert.match(
  app,
  /<SectionErrorBoundary[\s\S]*?<RenderRegion/,
  "Dynamic workbench regions must recover locally instead of replacing the page."
);
assert.match(
  app,
  /document-operation/,
  "Rejected document IPC operations must be reported and handled."
);
assert.match(
  app,
  /复制 Markdown 全文和图片[\s\S]*?documentPath=\{markdownDocument\.path\}/,
  "The Markdown panel must expose image-aware full-document copy and bind the editor to its path."
);
assert.match(
  app,
  /type WorkspaceView = "conversation" \| "tasks" \| "news"/,
  "Industry news must have its own first-class workspace view."
);
assert.match(
  app,
  /<strong>新建任务<\/strong>/,
  "The primary creation action must be presented as a new task."
);
assert.match(
  app,
  /workspaceView === "news"\s*\?\s*renderNewsWorkspace\(\)/,
  "The news navigation item must render the dedicated news workspace."
);
assert.match(
  app,
  /workspaceView === "documents"\s*\?\s*renderDocumentLibrary\(\)/,
  "The document-library navigation item must render the local library workspace."
);
assert.match(
  app,
  /function renderNewTaskHome\(\)[\s\S]*?NEW_TASK_QUOTE[\s\S]*?visibleQuickStartWorkflows/,
  "The empty task view must retain the quote and workflow suggestion cards."
);
assert.match(
  app,
  /const plaudEnabled = appSettings\?\.plaudConnectionMode === "enabled"[\s\S]*?workflow\.requiresPlaud \|\| plaudEnabled/,
  "PLAUD-dependent quick starts must remain hidden until the user enables PLAUD."
);
assert.match(
  setupCenter,
  /if \(required && !connectionVerified\) \{[\s\S]*?const verified = await testConnection\(\);[\s\S]*?if \(!verified\) return;/,
  "First-run Next must run the full Codex connection test instead of blocking on a hidden prerequisite."
);
assert.match(
  setupCenter,
  /autoInstallAttemptedRef[\s\S]*?!required[\s\S]*?codexStatus === null[\s\S]*?codexInstalled[\s\S]*?void installCodex\(true\)/,
  "First-run onboarding must install Codex automatically after the initial binary check."
);
assert.match(
  setupCenter,
  /Codex CLI 自动安装未完成[\s\S]*?onClick=\{\(\) => void installCodex\(false\)\}[\s\S]*?重新安装/,
  "A failed automatic Codex install must expose an explicit retry without restoring the old manual first step."
);
assert.match(
  setupCenter,
  /disabled=\{saving \|\| connectionTestBusy \|\| installBusy \|\| !codexInstalled\}/,
  "Onboarding must not advance while the required Codex installation is incomplete."
);
assert.match(
  setupCenter,
  /connectionTestBusy[\s\S]*?"正在测试并进入…"/,
  "The first-run primary action must explain that it is testing before advancing."
);
assert.doesNotMatch(
  app,
  /workflow-launcher-dock/,
  "The removed workflow launcher must not return above the conversation composer."
);

assert.match(
  sectionBoundary,
  /getDerivedStateFromError/,
  "Section boundaries must convert render failures into local recovery state."
);
assert.match(
  sectionBoundary,
  /<Fragment key=\{this\.state\.retryKey\}>/,
  "Streaming updates must not remount healthy section contents."
);
assert.doesNotMatch(
  sectionBoundary,
  /<Fragment key=\{`\$\{this\.props\.resetKey\}/,
  "Section reset signals must not replay message entrance animations."
);
assert.match(
  main,
  /markdown-editor-operation/,
  "The main process must accept Markdown operation reports."
);
assert.match(
  main,
  /section-boundary/,
  "The main process must accept local section failure reports."
);
assert.match(
  main,
  /markdown:image-preview[\s\S]*?markdown:image-save[\s\S]*?markdown:copy/,
  "The main process must expose Markdown image preview, save and rich-copy IPC."
);
assert.match(
  preload,
  /resolveMarkdownImage[\s\S]*?saveMarkdownImage[\s\S]*?copyMarkdown/,
  "The isolated renderer bridge must expose the Markdown image operations."
);
assert.match(
  app,
  /WEEKLY_NEWS_LIGHT_SYNC_INTERVAL_MS[\s\S]*?WEEKLY_NEWS_RADAR_INTERVAL_MS/,
  "Weekly news must retain separate lightweight and radar refresh schedules."
);
assert.match(
  taxonomy,
  /智能出行:\s*\[[\s\S]*?"汽车芯片"/,
  "Automotive chips must follow the project library taxonomy under smart mobility."
);
assert.doesNotMatch(
  taxonomy.match(/AI:\s*\[[\s\S]*?\n\s*\],/)?.[0] || "",
  /汽车芯片/,
  "Automotive chips must not appear under AI."
);
assert.match(
  app,
  /projectSubdomainsForNews\(item\.subdomains,\s*weeklyNewsDomain\)/,
  "Weekly news subdomain tabs must use the project library parent-child taxonomy."
);
assert.match(
  app,
  /radarWorkflow\.defaultPrompt,\s*FOLLOWED_PROJECT_TAXONOMY_PROMPT,/,
  "Future radar scans must validate classifications against the same project taxonomy."
);
assert.match(
  styles,
  /\.thread-row:has\(\.thread-menu\)\s*\{[\s\S]*?content-visibility:\s*visible;/,
  "An open thread menu must escape the row's automatic paint containment."
);
assert.match(
  styles,
  /\.main-grid\.news-view\.right-closed \.weekly-news-grid,[\s\S]*?grid-template-columns:\s*repeat\(3,/,
  "Closing the context panel must expand the industry news feed to three columns."
);
assert.match(
  app,
  /visibilitychange[\s\S]*?runTick/,
  "Weekly news automation must refresh when the app returns to the foreground."
);
assert.match(
  app,
  /!weeklyNewsAutomationReady \|\| !appSettings\?\.onboardingComplete/,
  "Weekly news automation must stay idle until first-run onboarding is complete."
);
assert.match(
  app,
  /background:\s*automatic[\s\S]*?result\.stopped/,
  "Automatic radar runs must be pausable during Codex connection maintenance."
);
assert.match(
  main,
  /prepareCodexConnectionMaintenance[\s\S]*?partitionCodexRuns\(activeRuns\.values\(\)\)/,
  "Codex connection maintenance must distinguish background automation from user tasks."
);
assert.match(
  main,
  /backgroundThrottling:\s*false/,
  "The renderer scheduler must continue while the app is minimized."
);
assert.match(
  preload,
  /showNotification:[\s\S]*?app:notify/,
  "Important weekly news must be able to reach the native notification bridge."
);
assert.match(
  app,
  /item\.queueStage === "managed"\) return "已生成并入库"/,
  "Completed PLAUD project recordings must display their archived state."
);
assert.match(
  app,
  /refreshPlaudQueue\(\{ fresh: true \}\)/,
  "PLAUD workflow completion must bypass stale queue snapshots."
);
assert.match(
  main,
  /const fresh = request\?\.fresh === true[\s\S]*?force: fresh[\s\S]*?allowStale: !fresh/,
  "Fresh PLAUD status reads must bypass the service cache and stale fallback."
);

console.log("renderer resilience checks passed");
