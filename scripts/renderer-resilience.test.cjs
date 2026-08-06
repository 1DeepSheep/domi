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
const workspaceBoundary = read("electron/workspace-boundary.cjs");
const preload = read("electron/preload.cjs");
const taxonomy = read("src/investmentTaxonomy.ts");
const canonicalTaxonomy = JSON.parse(read("shared/investment-taxonomy.json"));
const styles = read("src/styles.css");
const workflows = read("src/workflows.ts");

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
  editor,
  /findEditorTextMatches[\s\S]*?SEARCH_RESULT_HIGHLIGHT[\s\S]*?applyEditorSearchHighlights/,
  "Markdown search must locate and highlight editor text without mutating the document."
);
assert.match(
  editor,
  /event\.ctrlKey \|\| event\.metaKey[\s\S]*?key\.toLocaleLowerCase\("en-US"\) === "f"[\s\S]*?preventDefault/,
  "Markdown search must intercept Ctrl/Command+F while the document preview is open."
);
assert.match(
  editor,
  /event\.key === "Enter"[\s\S]*?event\.shiftKey \? -1 : 1[\s\S]*?上一个匹配[\s\S]*?下一个匹配/,
  "Markdown search must support keyboard and button navigation between matches."
);
assert.match(
  app,
  /person\.documents \|\| person\.interactionDocuments[\s\S]*?相关文档/,
  "The people database must expose research and interaction documents through one compact document column."
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
  /MARKDOWN_AUTO_SAVE_DELAY_MS[\s\S]*?markdownSaveInFlightRef[\s\S]*?scheduleMarkdownAutoSave[\s\S]*?async function saveOpenMarkdown\(\): Promise<boolean>/,
  "Markdown edits must debounce and serialize automatic saves."
);
assert.match(
  app,
  /openMarkdown[\s\S]*?await saveOpenMarkdown\(\)[\s\S]*?openPdf[\s\S]*?await saveOpenMarkdown\(\)[\s\S]*?async function closeMarkdown[\s\S]*?await saveOpenMarkdown\(\)/,
  "Switching or closing documents must flush pending Markdown edits."
);
assert.match(
  app,
  /markdownExternalOpenInFlightRef[\s\S]*?async function openMarkdownInExternalEditor[\s\S]*?await saveOpenMarkdown\(\)[\s\S]*?await closeMarkdown\(\)[\s\S]*?openMarkdownExternal/,
  "External Markdown opening must be deduplicated and release the internal editor after saving."
);
assert.match(
  main,
  /async function openMarkdownExternally[\s\S]*?resolveMarkdownPath[\s\S]*?\/usr\/bin\/open[\s\S]*?TextEdit/,
  "macOS Markdown files must bypass unstable default associations and use the system text editor."
);
assert.match(
  preload,
  /openMarkdownExternal[\s\S]*?markdown:open-external/,
  "External Markdown opening must use a dedicated preload bridge."
);
assert.doesNotMatch(
  app,
  /当前 Markdown 文件尚未保存/,
  "Normal Markdown navigation must not show a discard prompt now that edits auto-save."
);
assert.match(
  app,
  /key=\{`\$\{markdownDocument\.path\}:\$\{markdownOpenRequestRef\.current\}`\}/,
  "Successful automatic saves must not remount the editor or lose its cursor."
);
assert.match(
  editor,
  /onBlur[\s\S]*?relatedTarget[\s\S]*?event\.currentTarget\.contains\(nextTarget\)[\s\S]*?onBlur\?\.\(\)/,
  "Leaving the Markdown editor must immediately flush its automatic save."
);
assert.match(
  editor,
  /MARKDOWN_CHANGE_PUBLISH_DELAY_MS[\s\S]*?scheduleEditorMarkdownPublish[\s\S]*?onUpdate[\s\S]*?scheduleEditorMarkdownPublish\(\)/,
  "Typing must coalesce full-document Markdown serialization before updating the workbench."
);
assert.match(
  app,
  /MARKDOWN_AUTO_SAVE_RETRY_DELAYS_MS[\s\S]*?adaptiveDelayMs[\s\S]*?scheduleMarkdownAutoSaveRetry[\s\S]*?result\.conflict/,
  "Markdown automatic saves must adapt for large files and retry transient failures without retrying conflicts."
);
assert.match(
  main,
  /domi-\$\{process\.pid\}-\$\{Date\.now\(\)\}\.tmp[\s\S]*?latestStat[\s\S]*?fs\.promises\.rename\(temporaryPath, resolved\)[\s\S]*?fs\.promises\.rm\(temporaryPath/,
  "Markdown writes must use a same-directory atomic replacement and clean up temporary files."
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
assert.doesNotMatch(
  app.match(/async function createThread\(\)[\s\S]*?async function stopRun/)?.[0] || "",
  /createProjectWorkspace/,
  "A blank task must not allocate a hidden workspace before an actual project is resolved."
);
assert.match(
  app,
  /import \{ filesFromClipboardData \}[\s\S]*?handleComposerPaste[\s\S]*?filesFromClipboardData\(event\.clipboardData\)/,
  "Composer image paste must select one authoritative clipboard file view instead of importing files and items twice."
);
assert.match(
  app,
  /projectMentionMatches[\s\S]*?chooseMentionedProject[\s\S]*?bindThreadToMentionedProject/,
  "Explicit project candidates must be resolved before a task binds and archives attachments."
);
assert.match(
  app,
  /PERSON_TARGET_WORKFLOW_IDS[\s\S]*?workflowAllowsProjectRouting\(workflow\)[\s\S]*?thread\.externalType === "person"/,
  "People intake and sourcing workflows must not project-route their attachments before the person target is known."
);
assert.match(
  app,
  /当前对话归属于[\s\S]*?是否切换到[\s\S]*?较短或含数字[\s\S]*?多个项目[\s\S]*?本次消息尚未发送/,
  "Cross-project and ambiguous messages must ask before changing the canonical archive target."
);
assert.match(
  app,
  /let effectiveDomiSnapshot = domiSnapshot[\s\S]*?loadDomiCache\(\)[\s\S]*?bindThreadToMentionedProject\([\s\S]*?effectiveDomiSnapshot/,
  "A cold-start submission must pass the cache snapshot directly into project binding without waiting for React state."
);
assert.match(
  app,
  /resolveDomiEntityWorkspacePath\([\s\S]*?snapshot: DomiSnapshot \| null = domiSnapshot[\s\S]*?snapshot\?\.backend[\s\S]*?domiContextForThread\(effectiveDomiSnapshot, targetThread\)/,
  "A cold-start cache snapshot must drive both canonical workspace resolution and the first-turn project context."
);
assert.match(
  main,
  /async function importLocalFileData[\s\S]*?const createdTargets = \[\][\s\S]*?for \(const \[index, sourceFile\] of sourceFiles\.entries\(\)\)[\s\S]*?createdTargets\.push\(targetPath\)[\s\S]*?Promise\.allSettled\(createdTargets\.map/,
  "Clipboard and drag attachment batches must roll back every target when any file fails."
);
assert.match(
  preload,
  /loadDomiEntityWorkspace[\s\S]*?domi:entity-workspace/,
  "The renderer bridge must expose the lightweight canonical entity workspace lookup."
);
assert.match(
  main,
  /ipcMain\.handle\("domi:entity-workspace"[\s\S]*?\.entityWorkspace\(request\)/,
  "Canonical entity workspace lookup must not require a recursive materials scan."
);
assert.match(
  app,
  /resolveDomiEntityWorkspacePath[\s\S]*?loadDomiEntityWorkspace/,
  "Project and person task setup must use the lightweight workspace lookup."
);
assert.equal(
  (app.match(/loadDomiEntityMaterials/g) || []).length,
  1,
  "Recursive entity material loading must remain confined to the asynchronous overview refresh."
);
assert.doesNotMatch(
  app,
  /async function openDomiProject[\s\S]*?loadDomiEntityMaterials[\s\S]*?async function openDomiPerson/,
  "Opening a project must not block on the recursive materials scan."
);
assert.doesNotMatch(
  app,
  /async function openDomiPerson[\s\S]*?loadDomiEntityMaterials[\s\S]*?function updateActiveThread/,
  "Opening a person must not block on the recursive materials scan."
);
assert.match(
  workflows,
  /只有这些任务才先完整读取 \$domi:domi-router[\s\S]*?普通研究、分析、评级、项目管理或交易任务直接选择最匹配的单项 domi Skill/,
  "Ordinary domi tasks must not pay the Router startup cost before loading their matching skill."
);
assert.match(
  workflows,
  /非招股书且用户未要求 slides、HTML、PDF 或 PPTX 时，默认只交付一份完整基本面分析主报告/,
  "Ordinary fundamental analysis must not create a bundle of redundant intermediate artifacts."
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
  /function renderDatabaseWorkspace\(\)[\s\S]*?database-grid-table project[\s\S]*?database-grid-table person[\s\S]*?database-grid-table news/,
  "Projects, people, and industry information must render as spreadsheet-style database grids."
);
assert.match(
  app,
  /documentLibrarySearchMatches[\s\S]*?moveDocumentLibrarySearchSelection[\s\S]*?event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"[\s\S]*?openActiveDocumentLibrarySearchResult/,
  "Document-library search must support keyboard selection and opening."
);
assert.match(
  app,
  /databaseFilterKey[\s\S]*?databaseFilterValue[\s\S]*?databaseSortKey[\s\S]*?databaseSortDirection[\s\S]*?filtered\.length/,
  "Database grids must expose filtering, sorting, and a visible result count."
);
assert.match(
  app,
  /project:[\s\S]*?value: "rating", label: "项目评级"[\s\S]*?value: "city", label: "城市"[\s\S]*?value: "investor", label: "投资机构"/,
  "Project database filters must cover rating, city, taxonomy, status, and investors."
);
assert.match(
  app,
  /DATABASE_SORT_OPTIONS[\s\S]*?value: "rating", label: "项目评级"[\s\S]*?value: "valuation", label: "最新估值"/,
  "Project database sorting must cover rating and valuation."
);
assert.match(
  app,
  /\{ S: 4, A: 3, B: 2, C: 1 \}/,
  "Database rating sorting must follow the investment ranking order S, A, B, C."
);
assert.match(
  app,
  /\["classification", "分类审核", classificationReviews\.length\][\s\S]*?项目自身材料[\s\S]*?可比公司 \/ 相关公司[\s\S]*?行业与赛道材料/,
  "Classification review must be a peer database tab and keep material roles visibly separate."
);
assert.match(
  app,
  /新建正式子领域[\s\S]*?更新应用后仍会保留，不会上传 GitHub[\s\S]*?创建并应用/,
  "Users must be able to create a local formal subdomain with an explicit privacy confirmation."
);
assert.match(
  preload,
  /classifyDomiDatabaseProject:[\s\S]*?domi:database-classify/,
  "The isolated renderer bridge must expose the atomic classification operation."
);
assert.match(
  main,
  /ipcMain\.handle\("domi:database-classify"[\s\S]*?classifyDatabaseProject/,
  "The main process must own classification writes instead of letting the renderer touch local files."
);
assert.match(
  app,
  /filtered\.slice\(0, databaseVisibleLimit\)[\s\S]*?setDatabaseVisibleLimit\(\(current\) => current \+ 100\)/,
  "Large database grids must render progressively instead of mounting every record at once."
);
assert.match(
  app,
  /data-database-editable[\s\S]*?handleDatabaseRowClick\(event,/,
  "Database cells must enter editing with a single click from the grid."
);
assert.match(
  app,
  /DATABASE_EXPANDED_TEXT_FIELDS[\s\S]*?scrollWidth[\s\S]*?setDatabaseExpandedCell[\s\S]*?database-cell-expanded-editor[\s\S]*?完整内容/,
  "Long or truncated database cells must reliably open a readable expanded editor."
);
assert.match(
  app,
  /updateDatabaseDraft[\s\S]*?scheduleDatabaseAutoSave\(next\)[\s\S]*?async function flushDatabaseAutoSave[\s\S]*?已自动保存/,
  "Database edits must debounce and automatically persist without a save button."
);
assert.match(
  app,
  /database-cell-expanded-editor[\s\S]*?输入后自动保存[\s\S]*?修改自动保存/,
  "Expanded database cells must clearly expose automatic persistence."
);
assert.match(
  styles,
  /\.database-grid-shell[\s\S]*?overflow:\s*auto[\s\S]*?\.database-grid-table \.primary-column[\s\S]*?position:\s*sticky/,
  "Wide database grids must scroll while keeping their primary column visible."
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
  app,
  /if \(!weeklyNewsAutomationReady\) return;[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?void refreshPlaudQueue\(\);[\s\S]*?\}, 1_200\)[\s\S]*?\[plaudEnabled, appSettings\?\.plaudBrowser, weeklyNewsAutomationReady\]/,
  "PLAUD startup must wait for core integrations and remain isolated from unrelated settings saves."
);
assert.doesNotMatch(
  app,
  /integrationBootstrapStartedRef/,
  "StrictMode cleanup must not permanently suppress the second integration bootstrap."
);
assert.match(
  app,
  /const NEW_THREAD_MODEL = "default";[\s\S]*?const NEW_THREAD_REASONING_EFFORT = "max";[\s\S]*?const NEW_THREAD_SERVICE_TIER = "priority";/,
  "New tasks must keep Max reasoning on the Fast service tier by default."
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
assert.match(
  setupCenter,
  /async function save\(complete: boolean\)[\s\S]*?try \{[\s\S]*?await onSave[\s\S]*?catch \(saveError\)[\s\S]*?finally \{[\s\S]*?setSaving\(false\)/,
  "A rejected settings save must always release the setup-wide saving lock."
);
assert.match(
  setupCenter,
  /getUpdateStatus\(\)[\s\S]*?\.catch\(\(statusError\)[\s\S]*?getCodexRuntimeStatus\(\)[\s\S]*?\.catch\(\(runtimeError\)/,
  "Setup must surface rejected update and runtime status IPC reads instead of leaking unhandled promises."
);
assert.match(
  setupCenter,
  /let receivedLiveUpdateStatus = false;[\s\S]*?onUpdateStatus\(\(status\) => \{[\s\S]*?receivedLiveUpdateStatus = true;[\s\S]*?getUpdateStatus\(\)\.then\(\(status\) => \{[\s\S]*?!receivedLiveUpdateStatus/,
  "A delayed setup update-status snapshot must not replace a newer live downloading or downloaded event."
);
assert.match(
  setupCenter,
  /async function installDownloadedUpdate\(\)[\s\S]*?try \{[\s\S]*?await workbench\.installUpdate\(\)[\s\S]*?catch \(updateError\)[\s\S]*?finally \{[\s\S]*?setUpdateBusy\(false\)/,
  "A rejected update install IPC call must always release the update busy lock."
);
assert.match(
  app,
  /void refreshAfterDataConnectionSave\(result\.settings\)/,
  "Saving a data connection must not wait for the first background synchronization."
);
assert.match(
  app,
  /documentLibraryLocationChanged[\s\S]*?documentLibraryRequestRef\.current \+= 1[\s\S]*?setDocumentLibrary\(null\)[\s\S]*?void refreshDocumentLibrary\(\)/,
  "Changing the configured repository must discard the legacy document tree and immediately load the domi workspace."
);
assert.match(
  app,
  /const requestId = \+\+documentLibraryRequestRef\.current[\s\S]*?requestId !== documentLibraryRequestRef\.current/,
  "A slow legacy document scan must not replace the newer domi workspace snapshot."
);
assert.match(
  setupCenter,
  /DOMI_OUTLOOK_PROFILE_CHECK_V1[\s\S]*?privateOutput:\s*true[\s\S]*?outlookCalendarEmailVerifiedAt/,
  "Outlook sender detection must use a private Codex result and persist the verified identity only in local settings."
);
assert.match(
  setupCenter,
  /<strong>发送账号<\/strong>[\s\S]*?draft\.outlookCalendarEmail[\s\S]*?重新检测/,
  "Calendar settings must show the verified Outlook sender and expose identity revalidation."
);
assert.doesNotMatch(
  app,
  /workflow-launcher-dock/,
  "The removed workflow launcher must not return above the conversation composer."
);

assert.match(
  app,
  /const visibleUpdateEntry = sidebarUpdateEntry\(updateStatus\)[\s\S]*?sidebar-update-card[\s\S]*?setSettingsInitialTab\("updates"\)[\s\S]*?setSettingsOpen\(true\)/,
  "An actionable software update must appear in the sidebar and open the existing update settings page."
);
assert.match(
  styles,
  /\.sidebar-update-card[\s\S]*?\.sidebar-update-card\.downloaded[\s\S]*?\.sidebar-update-copy/,
  "The conditional sidebar update entry must retain its compact available and ready states."
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
  /const archiveGenericOutput = !run\.privateOutput[\s\S]*?&& !run\.externalType[\s\S]*?const updateResearchCache = !run\.privateOutput && Boolean/,
  "Private Codex results must not be archived or written into the project research cache."
);
assert.match(
  main,
  /const archiveGenericOutput = !run\.privateOutput[\s\S]*?&& !run\.externalType[\s\S]*?secureWorkspaceSubdirectory\([\s\S]*?run\.workspacePath \|\| demoWorkspace,[\s\S]*?"outputs"/,
  "Canonical project and person directories must not receive generic task output folders."
);
assert.match(
  main,
  /publishCodexEvent\(run\.sender, run\.runId,[\s\S]*?run\.resolve\(result\);[\s\S]*?queueRunPostProcessing\(run, type, finishedAt\)/,
  "Foreground Codex results must be delivered before non-critical archive and cache maintenance starts."
);
assert.match(
  main,
  /output: run\.privateOutput \? "" : run\.output/,
  "Private Codex results must not be published through the global event stream."
);
assert.match(
  main,
  /resolveProjectResearchCacheScope[\s\S]*?entityWorkspace[\s\S]*?researchCacheScope\.allowed[\s\S]*?externalType: undefined/,
  "Project research caching must bind a record ID to its exact canonical local directory."
);
assert.match(
  main,
  /localEntityRequest[\s\S]*?getDomiIntegration\(\)\.entityWorkspace[\s\S]*?genericWorkspace = requestedWorkspace && !isEntityWorkspace[\s\S]*?const workspacePath = canonicalEntityWorkspace/,
  "A persisted project or person thread must run in the record's current canonical directory, not a stale task workspace."
);
assert.match(
  main,
  /validateWorkspace: \(\) => researchCacheWorkspaceIsCurrent\(run\)[\s\S]*?workspaceIdentity: directoryIdentity\(workspacePath\)/,
  "Background cache writes must revalidate both the record binding and directory identity."
);
assert.match(
  main,
  /NON_ARCHIVED_WORKFLOWS[\s\S]*?project-research[\s\S]*?&& !NON_ARCHIVED_WORKFLOWS\.has\(run\.workflowId\)/,
  "Read-only project workflows must not leave duplicate generic output files."
);
assert.match(
  main,
  /cleanupImportedStagingSources[\s\S]*?attempt < 2[\s\S]*?fs\.promises\.unlink[\s\S]*?attachment-staging-source-cleanup-failed[\s\S]*?fs\.promises\.copyFile[\s\S]*?await cleanupImportedStagingSources\(managedStagingSources\)/,
  "Auto-binding must retry managed staging cleanup without logging private paths or silently leaving duplicates."
);
assert.match(
  main,
  /discardManagedStagingAttachment[\s\S]*?managedStagingAttachment[\s\S]*?fs\.promises\.unlink[\s\S]*?files:discard-staged/,
  "Removing a composer attachment must delete only its application-managed staging copy."
);
assert.match(
  main,
  /secureWorkspaceSubdirectory[\s\S]*?stableDescendantRealPath[\s\S]*?attachmentDirectory[\s\S]*?secureWorkspaceSubdirectory/,
  "Application-managed attachment and output directories must reject symlink redirection."
);
assert.match(
  main,
  /validAttachmentWorkspace[\s\S]*?entityWorkspace\(\{ entityType, recordId \}\)[\s\S]*?candidate && !isEntityWorkspace\(candidate\)/,
  "Attachment writes must require an exact registered entity record instead of accepting an arbitrary category directory."
);
assert.match(
  main,
  /entityType && recordId[\s\S]*?storageBackend !== "local"\) return ""/,
  "A Feishu entity without a stable local workspace must fail attachment commit instead of falling back to a generic task directory."
);
assert.match(
  main,
  /logicalStagingAttachmentName[\s\S]*?replace\(\/\^\\d\+-\\d\+-[\s\S]*?const name = logicalStagingAttachmentName/,
  "Moving a managed staged attachment must not stack a second timestamp prefix onto its logical name."
);
assert.match(
  app,
  /commitAttachmentsToEntity[\s\S]*?importFiles\([\s\S]*?entityType: thread\.externalType, recordId: thread\.externalRecordId/,
  "Committed attachments must carry the exact bound entity identity across IPC."
);
assert.match(
  app,
  /finalizeEntityBinding[\s\S]*?synced\.stale[\s\S]*?规范名称[\s\S]*?loadDomiEntityWorkspace[\s\S]*?attachmentsToCommit = context\.attachments[\s\S]*?setThreads/,
  "Machine receipts must be verified against a fresh snapshot and commit only this turn before atomically changing ownership."
);
assert.doesNotMatch(
  app.match(/async function finalizeEntityBinding[\s\S]*?function handleCodexEvent/)?.[0] || "",
  /thread\.messages\.flatMap/,
  "Entity finalization must never sweep attachment history from previous turns."
);
assert.match(
  app,
  /settlingThreadIdsRef[\s\S]*?finalizeEntityBinding[\s\S]*?\.finally\(releaseRun\)/,
  "A completed run must retain its per-thread lock until entity binding and attachment settlement finish."
);
assert.match(
  app,
  /QUEUED_SUBMISSIONS_STORAGE_KEY[\s\S]*?readQueuedSubmissions[\s\S]*?onAccepted[\s\S]*?result\.stopped[\s\S]*?retryQueuedSubmission/,
  "Queued work must persist locally, dequeue only after acceptance, and be recoverable after cancellation or failure."
);
assert.match(
  app,
  /attachmentImportCount > 0[\s\S]*?附件仍在导入[\s\S]*?disabled=\{[\s\S]*?attachmentImportCount > 0/,
  "The composer must block submission while a pasted or dropped attachment is still importing."
);
assert.match(
  workspaceBoundary,
  /realpathSync\.native[\s\S]*?allowRoot: false/,
  "Entity workspaces must use real paths and reject repository roots or symlink escapes."
);
assert.match(
  main,
  /pendingRunPostProcessing[\s\S]*?Promise\.allSettled[\s\S]*?drainRunPostProcessing/,
  "Background archive and cache maintenance must be tracked and drained during app shutdown."
);
assert.match(
  main,
  /const codexConnectionChanged = \[[\s\S]*?const dataConnectionChanged = \[[\s\S]*?if \(!codexConnectionChanged\) return \{ ok: true/,
  "Saving a data repository must not restart and fully revalidate Codex."
);
assert.match(
  main,
  /liveCodexThreads\.get\(payload\.threadId\) === runtimeKey[\s\S]*?return payload\.threadId/,
  "A persistent App Server session must reuse its live thread without repeating thread/resume."
);
assert.match(
  main,
  /runCodexCheckCached[\s\S]*?CODEX_CHECK_CACHE_TTL_MS[\s\S]*?ipcMain\.handle\("codex:check", runCodexCheckCached\)/,
  "Repeated renderer status checks must share the cached Codex health result."
);
assert.match(
  main,
  /researchCachePromise = prepareProjectResearchCache[\s\S]*?repositoryContextPromise = Promise\.resolve[\s\S]*?larkContextPromise = larkRuntimeContext[\s\S]*?threadPromise = client\.start\(\)\.then[\s\S]*?Promise\.all\(\[[\s\S]*?threadPromise,[\s\S]*?repositoryContextPromise,[\s\S]*?larkContextPromise,[\s\S]*?researchCachePromise/,
  "Codex startup, repository context, external-connection preflight, and research cache preparation must run concurrently."
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
assert.ok(
  canonicalTaxonomy["智能出行"].includes("汽车芯片"),
  "Automotive chips must follow the project library taxonomy under smart mobility."
);
assert.equal(
  canonicalTaxonomy.AI.includes("汽车芯片"),
  false,
  "Automotive chips must not appear under AI."
);
assert.match(
  taxonomy,
  /import canonicalTaxonomy from "\.\.\/shared\/investment-taxonomy\.json"/,
  "The renderer must consume the same canonical taxonomy file as the local repository."
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
  app,
  /async function syncManagedTasks\([^)]*\)[\s\S]*?workbench\.syncDomi\(\)[\s\S]*?todoRecentEntriesContext\([\s\S]*?workbench\.runCodex\(\{[\s\S]*?ephemeral:\s*true,[\s\S]*?background:\s*true,[\s\S]*?workflowId:\s*todoWorkflow\.id,[\s\S]*?reasoningEffort,[\s\S]*?serviceTier,[\s\S]*?await refreshDomiTaskBoard\(\{ fresh: true \}\)/,
  "Todo-board sync must refresh the data snapshot, keep the selected Max/Fast defaults, pass candidates to a temporary background Todo Skill run, and then reread the active backend document."
);
assert.doesNotMatch(
  app.match(/async function syncManagedTasks\([^)]*\)[\s\S]*?\n  async function refreshDomiEntityOverview/)?.[0] || "",
  /createProjectWorkspace|setThreads|executeSuggestion/,
  "Todo-board sync must not create a project workspace or a visible conversation task."
);
assert.match(
  app.match(/async function syncManagedTasks\([^)]*\)[\s\S]*?\n  async function refreshDomiEntityOverview/)?.[0] || "",
  /Promise\.race\([\s\S]*?resultOrTimeout\.kind === "timeout"[\s\S]*?await workbench\.stopCodex\(runId\)[\s\S]*?await refreshDomiTaskBoard\(\{ silent: true, fresh: true \}\)[\s\S]*?超过 8 分钟/,
  "Todo-board sync must await safe interruption of an overlong background run before rereading the ledger."
);
assert.match(
  app.match(/async function syncManagedTasks\([^)]*\)[\s\S]*?\n  async function refreshDomiEntityOverview/)?.[0] || "",
  /workbench\.listDomiTasks\(\{ fresh: true \}\)[\s\S]*?resultOrTimeout\.kind === "ledger"[\s\S]*?setDomiTaskBoard\(resultOrTimeout\.snapshot\)[\s\S]*?await refreshDomiTaskBoard\(\{ fresh: true \}\)[\s\S]*?updateSyncPhase\("completed"/,
  "Todo-board sync must detect a freshly written ledger and refresh the board without waiting for the background report to finish."
);
assert.match(
  app,
  /domiTaskSyncQueued[\s\S]*?runningTaskThreads\.length > 0[\s\S]*?syncManagedTasks\(\{ bypassQueue: true \}\)/,
  "Todo-board sync must wait for foreground Codex runs to finish instead of competing for model capacity."
);
assert.match(
  app,
  /const status = await workbench\.checkCodex\(\)[\s\S]*?if \(!status\.pluginSetup\?\.ok\)[\s\S]*?await Promise\.allSettled\(\[[\s\S]*?refreshDomi\(\)[\s\S]*?refreshDomiTaskBoard[\s\S]*?refreshWeeklyNews/,
  "Initial integration sync must wait for the bundled plugin check, then refresh independent data, todo and news sources concurrently."
);
assert.match(
  app,
  /workflowId === "schedule"[\s\S]*?客户端会在成功后更新待办事项状态[\s\S]*?await updateManagedTask\(task\.id, "done"\)/,
  "The client must deterministically complete a todo only after its schedule action succeeds."
);
const managedTaskBoardSource = app.match(
  /function renderTaskBoard\(\)[\s\S]*?\n  function renderLegacyTaskBoard\(\)/
)?.[0] || "";
assert.match(
  managedTaskBoardSource,
  /managed-task-sync-status[\s\S]*?domiTaskSyncState\.label[\s\S]*?domiTaskSyncElapsed/,
  "The task board must expose the background sync phase and elapsed time."
);
assert.match(
  managedTaskBoardSource,
  /onClick=\{\(\) => void syncManagedTasks\(\)\}[\s\S]*?\? "同步中"[\s\S]*?\? "等待中"[\s\S]*?: "同步"/,
  "The managed task board must expose sync as the single generation entry point."
);
assert.doesNotMatch(
  managedTaskBoardSource,
  />\s*更新建议\s*</,
  "The managed todo board must not render a separate update-suggestions button."
);
assert.match(
  managedTaskBoardSource,
  /<h1 id="task-board-title">待办事项<\/h1>[\s\S]*?todoDocumentLabel/,
  "The managed board must use the 待办事项 name and the active backend document label."
);
assert.match(
  managedTaskBoardSource,
  /近 4 周没有值得优先约见的新对象/,
  "The new-entry board must use the same four-week window as the Todo Skill."
);
const managedTaskColumnOrder = [
  'id: "new-entry"',
  'id: "project-follow-up"',
  'id: "relationship-follow-up"',
  'id: "key-milestone"'
].map((marker) => managedTaskBoardSource.indexOf(marker));
assert.ok(
  managedTaskColumnOrder.every((position) => position >= 0)
    && managedTaskColumnOrder.every((position, index) =>
      index === 0 || position > managedTaskColumnOrder[index - 1]
    ),
  "The todo board must place new entries and project follow-up above people follow-up and milestones."
);
assert.doesNotMatch(
  managedTaskBoardSource,
  /storageBackend\s*!==\s*"feishu"/,
  "Local workspaces must be allowed to run Todo Skill sync from the managed board."
);
assert.doesNotMatch(
  managedTaskBoardSource,
  /storageBackend\s*===\s*"local"[\s\S]*?return renderLegacyTaskBoard/,
  "Local workspaces must render the same managed four-category todo board as Feishu."
);
assert.match(
  workflows,
  /id:\s*"task"[\s\S]*?skill:\s*"\$domi:todo"[\s\S]*?1\.待办事项[\s\S]*?0\.待办事项\.md/,
  "The legacy workflow ID must invoke domi:todo and describe both backend documents."
);
assert.match(
  workflows,
  /id:\s*"schedule"[\s\S]*?quickStart:\s*true[\s\S]*?id:\s*"meeting-prep"[\s\S]*?quickStart:\s*true[\s\S]*?id:\s*"people-intake"[\s\S]*?quickStart:\s*true[\s\S]*?id:\s*"project-intake"[\s\S]*?quickStart:\s*true/,
  "The home page must keep the four primary workflows in the requested order."
);
const scheduleWorkflowSource = workflows.match(
  /id:\s*"schedule"[\s\S]*?(?=\n  \{|\n\];)/
)?.[0] || "";
assert.match(
  scheduleWorkflowSource,
  /一个或多个指定参会人[\s\S]*?没有选择参会人邮箱，必须先主动询问/,
  "Schedule must ask for one or more attendee emails before sending an Outlook invitation."
);
assert.match(
  scheduleWorkflowSource,
  /不要读取项目库、人脉库或待办事项文档/,
  "Schedule must explicitly avoid repository and todo lookups."
);
assert.doesNotMatch(
  scheduleWorkflowSource,
  /检查\s*Outlook\s*冲突/,
  "Schedule must stay a focused invitation flow instead of loading the conflict workflow."
);
assert.match(
  setupCenter,
  /常用参会人（可多个）[\s\S]*?outlookCalendarRecipients[\s\S]*?逗号、分号或换行分隔/,
  "Settings must support a locally stored multi-recipient attendee list."
);
assert.match(
  app,
  /schedule-recipient-picker[\s\S]*?commonCalendarRecipients\.map[\s\S]*?addCalendarRecipient/,
  "The schedule composer must expose common attendees as explicit multi-select shortcuts."
);
const taskWorkflowSource = workflows.match(/id:\s*"task"[\s\S]*?(?=\n  \{|\n\];)/)?.[0] || "";
const quickDiscussionWorkflowSource = workflows.match(
  /id:\s*"quick-discussion"[\s\S]*?(?=\n  \{|\n\];)/
)?.[0] || "";
assert.match(
  taskWorkflowSource,
  /hidden:\s*true/,
  "Todo sync must stay off the sidebar because the todo board owns its sync entry point."
);
assert.doesNotMatch(
  taskWorkflowSource,
  /quickStart:\s*true/,
  "Todo sync belongs in the todo board rather than the four home-page shortcuts."
);
assert.doesNotMatch(
  quickDiscussionWorkflowSource,
  /quickStart:\s*true/,
  "Quick discussion must not displace one of the four home-page shortcuts."
);
assert.match(
  app,
  /function migrateLegacyTodoThreadLabels[\s\S]*?更新任务建议[\s\S]*?同步待办事项[\s\S]*?1\.Task · 更新建议[\s\S]*?1\.待办事项 · 同步/,
  "Persisted task-generation thread labels must migrate to the todo terminology."
);
assert.match(
  setupCenter,
  /0\.待办事项\.md[\s\S]*?<strong>待办事项与日历<\/strong>[\s\S]*?1\.待办事项[\s\S]*?0\.待办事项\.md/,
  "Settings must describe the automatically managed Feishu and local todo documents."
);
const localRepositoryOptionPosition = setupCenter.indexOf("<strong>本地资料库</strong>");
const feishuRepositoryOptionPosition = setupCenter.indexOf("<strong>飞书资料库</strong>");
assert.ok(
  localRepositoryOptionPosition >= 0
    && feishuRepositoryOptionPosition > localRepositoryOptionPosition,
  "Onboarding must place the preferred local repository option to the left of Feishu."
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
  /const fresh = request\?\.fresh === true[\s\S]*?plaudQueue\(\{ offset, limit, fresh \}\)[\s\S]*?retries: 0[\s\S]*?force: fresh[\s\S]*?allowStale: false/,
  "PLAUD reads must have one retry owner and fresh reads must bypass every service-level stale fallback."
);
assert.match(
  setupCenter,
  /plaudBrowser === "chrome"[\s\S]*?Google Chrome[\s\S]*?plaudBrowser === "tabbit"[\s\S]*?Tabbit/,
  "PLAUD onboarding must let each user choose Chrome or Tabbit."
);
assert.match(
  setupCenter,
  /loginPlaud\(\)[\s\S]*?workbench\.loginPlaud\(\{ browser \}\)[\s\S]*?只读验证/,
  "PLAUD login must use the dedicated browser flow and verify the remote account."
);
assert.doesNotMatch(
  setupCenter,
  /openResource\("\/Applications\/Tabbit\.app"\)/,
  "PLAUD onboarding must not hard-code or reuse the user's everyday Tabbit profile."
);
assert.match(
  preload,
  /loginPlaud:[\s\S]*?domi:plaud-login[\s\S]*?checkPlaudConnection:[\s\S]*?domi:plaud-connection[\s\S]*?disconnectPlaud:[\s\S]*?domi:plaud-disconnect/,
  "The renderer bridge must expose login, verification, and local-profile removal."
);
assert.match(
  setupCenter,
  /rate_limited:\s*"PLAUD 暂时限流"[\s\S]*?service_unavailable:\s*"PLAUD 服务暂时不可用"/,
  "PLAUD settings must explain vendor throttling and outages without asking for a new login."
);
assert.match(
  app,
  /loadMorePlaudQueue[\s\S]*?setPlaudSnapshot[\s\S]*?remoteStatus:\s*result\.remoteStatus[\s\S]*?retryable:\s*result\.retryable/,
  "A later-page failure must propagate its remote status so the recovery action stays accurate."
);
assert.match(
  app,
  /WORKSPACE_SCROLL_SELECTORS[\s\S]*?captureWorkspaceUiState[\s\S]*?restoreWorkspaceUiState[\s\S]*?navigateWorkspace/,
  "Each workspace view must preserve its own scroll and right-panel state."
);
assert.doesNotMatch(
  app,
  /conversation:\s*\[[^\]]*\.chat-scroll/,
  "Per-thread conversation scroll must not be overwritten by workspace-level restoration."
);
assert.match(
  app,
  /flushDatabaseAutoSaveAndWait[\s\S]*?async function selectDatabaseRecord[\s\S]*?switchingRecord[\s\S]*?阻止切换[\s\S]*?async function switchDatabaseEntity/,
  "Database row and tab switches must wait for the previous record to persist."
);
assert.match(
  setupCenter,
  /hasUnsavedChanges[\s\S]*?requestClose[\s\S]*?设置尚未保存/,
  "Closing settings must warn before discarding an edited draft."
);
assert.match(
  app,
  /settingsDirtyRef[\s\S]*?flushClientStateRef\.current[\s\S]*?设置页还有未保存的修改/,
  "Application close must be blocked while settings contain unsaved changes."
);
assert.match(
  app,
  /DocumentPreviewOrigin[\s\S]*?previousRightPanelOpen[\s\S]*?restoreDocumentPreviewOrigin/,
  "Closing an internal document must restore the panel state that preceded it."
);
assert.match(
  app,
  /DATABASE_SAVE_RETRY_DELAYS_MS[\s\S]*?queueDatabaseAutoSaveRetry[\s\S]*?setGlobalPersistenceError/,
  "Failed database auto-saves must retain their draft, retry with backoff, and remain visible globally."
);
assert.match(
  app,
  /isThreadActivelyVisible[\s\S]*?workspaceViewRef\.current === "conversation"[\s\S]*?documentPanelFocusedRef/,
  "Task completion may be marked read only while its conversation is actually visible and focused."
);
assert.match(
  main,
  /requestRendererFlush[\s\S]*?app:prepare-close[\s\S]*?domi 已阻止关闭窗口[\s\S]*?before-quit/,
  "Window close and application quit must wait for renderer persistence and block on failure."
);
assert.match(
  preload,
  /onPrepareClose[\s\S]*?app:prepare-close-result/,
  "The renderer must acknowledge close preparation through the isolated preload bridge."
);
assert.match(
  main,
  /function bindCodexRun\(runId, sender\)[\s\S]*?run\.sender = sender[\s\S]*?ipcMain\.handle\("codex:bind-run", \(event, runId\) => bindCodexRun\(runId, event\.sender\)\)/,
  "A recovered live Codex thread must explicitly rebind subsequent events to the current renderer."
);
assert.match(
  app,
  /reboundRunId = result\.runId[\s\S]*?runContextRef\.current\.set\(reboundRunId[\s\S]*?await workbench\.bindCodexRun\(reboundRunId\)[\s\S]*?recoverCodexThread\(thread\.codexThreadId\)/,
  "The renderer must register recovery context before binding live events and reconcile a bind race."
);
assert.match(
  app,
  /result\.status === "completed"[\s\S]*?finalizeRecoveredEntityBinding[\s\S]*?function finalizeRecoveredEntityBinding[\s\S]*?parseDomiEntityResult\(output\)[\s\S]*?finalizeEntityBinding/,
  "A task completed while the window was closed must settle its verified entity workspace after recovery."
);
assert.match(
  preload,
  /recoverCodexThread:[\s\S]*?codex:recover-thread[\s\S]*?bindCodexRun:[\s\S]*?codex:bind-run/,
  "The isolated renderer bridge must expose the live-run bind handshake."
);
assert.match(
  app,
  /flushClientStateRef\.current = async \(\) =>[\s\S]*?settlingThreadIdsRef\.current\.size > 0[\s\S]*?项目资料仍在归档[\s\S]*?persistWorkbenchStateNow/,
  "Application close must wait for completed-run entity binding and attachment settlement."
);
assert.match(
  app,
  /const currentThreads = flushAssistantDeltas\(\)[\s\S]*?function flushAssistantDeltas\(\): Thread\[\][\s\S]*?threadsRef\.current = nextSnapshot/,
  "A close-time persistence snapshot must synchronously include buffered assistant deltas."
);
assert.match(
  app,
  /async function openDomiProject\(project: DomiProject\) \{\s*if \(!await navigateWorkspace\("conversation"\)\) return;[\s\S]*?async function openDomiPerson\(person: DomiPerson\) \{\s*if \(!await navigateWorkspace\("conversation"\)\) return;/,
  "Opening a project or person for the first time must visibly enter its conversation."
);
assert.match(
  app,
  /async function openDocumentLibrary\(\)[\s\S]*?if \(!await navigateWorkspace\("documents"\)\) return;[\s\S]*?async function openPrimaryWorkspace\(view: "tasks" \| "news" \| "data"\)[\s\S]*?if \(!await navigateWorkspace\(view\)\) return;/,
  "Sidebar UI state must change only after the current page has safely completed navigation."
);

const deleteThreadStart = app.indexOf("function deleteThread(thread: Thread)");
const deleteThreadEnd = app.indexOf("function toggleSection", deleteThreadStart);
assert.ok(deleteThreadStart >= 0 && deleteThreadEnd > deleteThreadStart);
const deleteThreadBody = app.slice(deleteThreadStart, deleteThreadEnd);
assert.doesNotMatch(
  deleteThreadBody,
  /thread\.messages|message\.attachments/,
  "Deleting a conversation must not delete attachments referenced by historical messages."
);
assert.match(
  app,
  /PAUSED_QUEUED_SUBMISSIONS_STORAGE_KEY[\s\S]*?readPausedQueuedSubmissionIds[\s\S]*?JSON\.stringify\(\[\.\.\.pausedQueuedSubmissionIds\]\)/,
  "Paused queue state must survive an application restart."
);
assert.match(
  app,
  /repositoryIdentity\?: string[\s\S]*?queueRepositoryIdentity[\s\S]*?!queued\.repositoryIdentity[\s\S]*?queued\.repositoryIdentity !== currentRepositoryIdentity/,
  "A queued task must not silently run against a different repository after restart or reconfiguration."
);
assert.match(
  app,
  /function pauseThreadQueueAfterTerminal[\s\S]*?context\.queuedSubmission[\s\S]*?setPausedQueuedSubmissionIds[\s\S]*?pauseThreadQueueAfterTerminal\(context\);\s*releaseRun\(\)/,
  "A stopped or failed queued task must be restored and paused before the next task can start."
);
assert.doesNotMatch(
  app,
  /\.filter\(\(item\): item is \{ submission: QueuedSubmission; thread: Thread \} => Boolean\(item\.thread\)\)/,
  "Queued tasks whose original conversation was deleted must remain visible and removable."
);
assert.match(
  app,
  /prepareNeutralProjectTarget[\s\S]*?workflow\?\.id === "project-intake" && thread\.externalType === "project"[\s\S]*?作为新项目暂存[\s\S]*?prepareNeutralProjectTarget/,
  "A new project launched from an existing project must use a neutral staging thread instead of polluting the old project."
);
assert.match(
  app,
  /if \(!storageReady \|\| codexRecoveryStartedRef\.current\) return;[\s\S]*?for \(const thread of candidates\)[\s\S]*?setCodexRecoveryReady\(true\)[\s\S]*?if \(!storageReady \|\| !codexRecoveryReady \|\| !appSettings\) return;/,
  "The persistent queue pump must wait until storage loading and every candidate Codex recovery have settled."
);
assert.match(
  app,
  /for \(const thread of candidates\)[\s\S]*?try \{[\s\S]*?await workbench\.recoverCodexThread[\s\S]*?catch \(error\)[\s\S]*?blockRecoveredThread/,
  "Each recovery candidate must settle independently so one rejected read cannot release the queue gate early."
);
assert.match(
  app,
  /pauseRecoveredThreadQueue[\s\S]*?blockRecoveredThread[\s\S]*?if \(!result\.ok\)[\s\S]*?result\.status === "running"[\s\S]*?!result\.runId[\s\S]*?bindCodexRun[\s\S]*?\["completed", "stopped", "failed"\][\s\S]*?result\.status === "stopped"[\s\S]*?pauseRecoveredThreadQueue\(thread\.id\)[\s\S]*?result\.status === "failed"[\s\S]*?pauseRecoveredThreadQueue\(thread\.id\)[\s\S]*?blockRecoveredThread/,
  "Unknown, unbound, stopped and failed recoveries must safely block or pause their thread queues."
);
assert.match(
  app,
  /result\.status === "completed"[\s\S]*?await finalizeRecoveredEntityBinding[\s\S]*?setCodexRecoveryReady\(true\)/,
  "Completed recoveries must finish entity finalization before the persistent queue gate opens."
);
assert.match(
  main,
  /async function recoverCodexThread[\s\S]*?const activeRun = \[\.\.\.activeRuns\.values\(\)\][\s\S]*?catch \(error\)[\s\S]*?if \(activeRun\)[\s\S]*?status: "running"/,
  "A live main-process run must remain recoverable when the diagnostic thread read transiently fails."
);
assert.doesNotMatch(
  app.match(/const candidates = threadsRef\.current[\s\S]*?void \(async \(\) =>/)?.[0] || "",
  /\.slice\(/,
  "Codex recovery must not leave later candidate threads unreconciled before starting queued work."
);
assert.match(
  app,
  /const routedQueuedSubmission = options\.queuedSubmission[\s\S]*?threadId: targetThread\.id[\s\S]*?attachments: selectedAttachments[\s\S]*?repositoryIdentity: queueRepositoryIdentity\(appSettingsRef\.current\)[\s\S]*?queuedSubmission: routedQueuedSubmission[\s\S]*?onAccepted\?\.\(routedQueuedSubmission\)/,
  "A routed queued run must persist its final thread, attachment paths and repository identity before it can be restored."
);
const retainedQueueStart = app.indexOf(
  "if (options.queuedSubmission.threadId === targetThread.id)"
);
const crossTargetMoveStart = app.indexOf("const withoutSource", retainedQueueStart);
assert.ok(retainedQueueStart >= 0 && crossTargetMoveStart > retainedQueueStart);
const retainedQueueBranch = app.slice(retainedQueueStart, crossTargetMoveStart);
assert.match(
  retainedQueueBranch,
  /targetQueue\.map[\s\S]*?movedSubmission[\s\S]*?return \{ ok: true, queued: true/,
  "A same-thread target race must retain and normalize the existing queued item."
);
assert.doesNotMatch(
  retainedQueueBranch,
  /onAccepted/,
  "Retaining a same-thread queued item must not trigger source-dequeue semantics."
);
assert.match(
  app,
  /if \(!accepted && result && "queued" in result && result\.queued\)[\s\S]*?return;/,
  "The queue pump must recognize an intentionally retained item without pausing or deleting it."
);

console.log("renderer resilience checks passed");
