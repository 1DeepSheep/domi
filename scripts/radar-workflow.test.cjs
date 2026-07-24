const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const workflowsModule = await import(
    pathToFileURL(path.join(__dirname, "..", "src", "workflows.ts")).href
  );
  const {
    RADAR_MAX_LOOKBACK_MS,
    RADAR_OVERLAP_MS,
    radarDiscoveryWindow,
    radarPriorityPeopleContext,
    workflowPrompt,
    workflows
  } = workflowsModule;

  const now = Date.UTC(2026, 6, 23, 12);
  assert.deepEqual(radarDiscoveryWindow(now, 0), {
    discoveryFrom: now - RADAR_MAX_LOOKBACK_MS,
    checkedAfter: 0
  });
  assert.deepEqual(radarDiscoveryWindow(now, now - 60 * 60 * 1000), {
    discoveryFrom: now - 60 * 60 * 1000 - RADAR_OVERLAP_MS,
    checkedAfter: now - 60 * 60 * 1000
  });
  assert.equal(
    radarDiscoveryWindow(now, now - 71 * 60 * 60 * 1000).discoveryFrom,
    now - RADAR_MAX_LOOKBACK_MS,
    "overlap must never expand quick scan beyond the 72-hour ceiling"
  );

  const peopleContext = radarPriorityPeopleContext([
    {
      name: "重点人物甲",
      organization: "AI 芯片设计研究",
      rating: "A",
      status: "1.待Pitch"
    },
    {
      name: "重点人物 S",
      organization: "某机构",
      rating: "S",
      status: "待联系"
    },
    {
      name: "普通人物",
      organization: "某机构",
      rating: "B",
      status: "深度跟踪"
    },
    {
      name: "重点人物甲",
      organization: "AI 芯片设计研究",
      rating: "A",
      status: "1.待Pitch"
    }
  ]);
  assert.match(peopleContext, /A｜重点人物甲｜AI 芯片设计研究｜1\.待Pitch/);
  assert.match(peopleContext, /S｜重点人物 S/);
  assert.doesNotMatch(peopleContext, /普通人物/);
  assert.equal((peopleContext.match(/重点人物甲/g) || []).length, 1);
  assert.match(peopleContext, /关系进展只作消歧，不作为雷达准入条件/);

  const radarWorkflow = workflows.find((workflow) => workflow.id === "investment-radar");
  assert.ok(radarWorkflow);
  assert.match(radarWorkflow.defaultPrompt, /48 小时重叠回看/);
  assert.match(radarWorkflow.defaultPrompt, /DeepTech 深科技/);
  assert.match(radarWorkflow.defaultPrompt, /访谈/);

  const prompt = workflowPrompt(
    radarWorkflow,
    "本轮发现窗口起点：2026-07-20T12:00:00.000Z",
    peopleContext,
    true
  );
  assert.match(prompt, /重点人物甲/);
  assert.match(prompt, /不得逐人发起搜索/);
  assert.match(prompt, /\"discovery_from\"/);
  assert.match(prompt, /\"rejected\"/);
}

main()
  .then(() => {
    console.log("radar workflow tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
