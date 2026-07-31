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
  /databaseStatusFilter[\s\S]*?databaseSortKey[\s\S]*?databaseSortDirection[\s\S]*?filtered\.length/,
  "Database grids must expose filtering, sorting, and a visible result count."
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
  /run\.output\.trim\(\) && !run\.privateOutput[\s\S]*?output: run\.privateOutput \? "" : run\.output/,
  "Private Codex results must not be archived or published through the global event stream."
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
  /runtimeContextPromise = Promise\.all[\s\S]*?threadPromise = client\.start\(\)\.then[\s\S]*?Promise\.all\(\[[\s\S]*?threadPromise,[\s\S]*?runtimeContextPromise/,
  "Codex startup and external-connection preflight must run concurrently."
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
  /const fresh = request\?\.fresh === true[\s\S]*?force: fresh[\s\S]*?allowStale: !fresh/,
  "Fresh PLAUD status reads must bypass the service cache and stale fallback."
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

console.log("renderer resilience checks passed");
