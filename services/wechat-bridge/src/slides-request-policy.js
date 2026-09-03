// Shared by the desktop renderer and WeChat. A mention of a deck is not
// permission to create one; only current authoring intent inherits its QA gate.
export const SLIDES_DELIVERY_POLICIES = new Set([
  "html_pdf", "html_pdf_preserve_template", "explicit_pptx", "explicit_pptx_preserve_template",
]);

const SLIDE = /(?:\bpptx?\b|\bpowerpoint\b|\bkeynote\b|\bslides?\b|\bdeck\b|幻灯片|演示文稿|路演材料|汇报(?:材料|演示)?)/i;
const AUTHOR = /(?:制作|生成|输出|导出|创建|完成|做(?:一份|一个|成|个)?|画|写|更新|改版|修改|改(?:一下|第.{0,8}页|一版)|重做|修复|改进|美化|完善|优化|排版|设计|整理|处理|转成|转换|create|make|generate|build|design|redesign|update|revise|edit|convert)/i;
const CHANGE = /(?:删除|删掉|去掉|移除|合并|增加|加上|加入|补充|替换|换成|缩小|放大|调整|修改|更新|改进|优化|美化|重做|修复|改|删|减|加|edit|revise|remove|delete|merge|replace|resize)/i;
const PAGE_CONTEXT = /(?:这|那|此|上|前|后|第[\d一二两三四五六七八九十百]+)[几\d一二两三四五六七八九十百]*\s*页|首页|末页|封面|页码|版式|排版|字体|字号|留白|行距|标题|图表|表格|配色|母版|模板|页面|page\s*\d|layout|font|chart|slide\s*\d/i;
const PRESERVE = /(?:保持|保留|沿用|继续使用|不要改|不改)\s*(?:原有的?|原来的?|原|现有的?|当前的?)?\s*(?:模板|版式|母版|主题)|(?:preserve|keep|retain)\s+(?:the\s+)?(?:existing|original|current)\s+(?:template|theme|master|layout)/i;
const EDITABLE = /(?:\bpptx\b|\.pptx\b|可编辑(?:的)?\s*(?:ppt|powerpoint|幻灯片|演示文稿)|(?:ppt|powerpoint)\s*(?:源文件|原文件)|(?:源文件|原文件)\s*(?:ppt|powerpoint)|editable\s+powerpoint)/i;
const NO_PPTX = /(?:不要|不用|无需|不需要|别|不交付|不生成|不输出|不制作|不要再)\s*(?:(?:用|使用|生成|输出|交付|制作|创建)\s*)?(?:可编辑(?:的)?\s*)?(?:pptx|powerpoint(?:\s*源文件)?)|(?:no|without|do not|don't)\s+(?:(?:create|generate|deliver|export|use)\s+)?(?:pptx|editable\s+powerpoint)|只(?:要|交付|生成|输出|给我)\s*(?:html|pdf)/i;
const NO_DECK = /(?:不要|不用|无需|不需要|别|先不)\s*(?:再\s*)?(?:生成|制作|创建|输出|做|画)\s*(?!(?:pptx|可编辑)\b)(?:任何)?(?:slides?\b|ppt\b|deck\b|幻灯片|演示文稿|汇报)|(?:do not|don't)\s+(?:create|generate|make)\s+(?:a\s+)?(?:deck|slides|presentation)/i;
const META = /(?:创建|新建|开发|修改|优化|设计).{0,35}(?:\bskill\b|技能|插件|路由|生成器)|(?:create|build|edit|design).{0,35}\b(?:skill|plugin|generator)\b/i;
const ADVICE = /^(?:请问|想问|我想知道|帮我看看)?\s*(?:为什么|为何|怎么|如何|是不是|是否|what\b|why\b|how\b)/i;
const FILE_OPERATION = /(?:打开|发给|发送|下载|查看|解释|介绍|说明|审阅|检查).{0,30}(?:slides?\b|pptx?\b|deck\b|幻灯片|演示文稿)|(?:slides?\b|pptx?\b|deck\b|幻灯片|演示文稿).{0,30}(?:发给|发送|下载|打开|是什么|做什么|怎么用)/i;
const SHORT_REVISION = /^(?:(?:请|帮我|麻烦你?)\s*)?(?:按(?:上面|之前|刚才|上述)(?:的)?要求\s*)?(?:修改|更新|修正|调整|改一下|改一版|优化|完善)(?:一下)?(?:吧)?[。！!\s]*$/;
const NEW_DECK = /(?:新任务|另一个任务|换个问题)|(?:生成|制作|创建|做)\s*(?:一份|一个)?\s*(?:新的|全新|另一份|另一个).{0,30}(?:pptx?|slides?|deck|幻灯片|演示文稿)/i;

function contextualRevisionIntent(text, previous) {
  if (!previous || NEW_DECK.test(text)) return false;
  return SHORT_REVISION.test(text)
    || (PAGE_CONTEXT.test(text) && CHANGE.test(text))
    || (/(?:只要|交付|输出|导出|改成|换成|不要|不用)/.test(text) && /(?:html|pdf|pptx|powerpoint)/i.test(text));
}

export function isContextualSlidesRevision(text, previousDeliveryPolicy = "") {
  const previous = SLIDES_DELIVERY_POLICIES.has(previousDeliveryPolicy) ? previousDeliveryPolicy : "";
  return contextualRevisionIntent(String(text || "").trim(), previous)
    && Boolean(resolveSlidesDeliveryPolicy({ text, previousDeliveryPolicy: previous }));
}

export function resolveSlidesDeliveryPolicy({ text = "", hasPowerPointAttachment = false, previousDeliveryPolicy = "", selectedSlides = false, awaitingSlidesInput = false } = {}) {
  const request = String(text).trim();
  const previous = SLIDES_DELIVERY_POLICIES.has(previousDeliveryPolicy) ? previousDeliveryPolicy : "";
  if (!request) return selectedSlides ? "html_pdf" : "";
  if (META.test(request) || NO_DECK.test(request)) return "";

  // Historical verbs in a question/file request are not current instructions.
  const currentText = request.replace(/(?:之前|此前|上次|先前|已经|刚才).{0,12}?(?:生成|制作|创建|输出|做)的?/gi, "");
  const clauses = currentText.split(/[，,。；;！!\n]+/).map((item) => item.trim()).filter(Boolean);
  const hasCurrentAction = (clause) => {
    if (ADVICE.test(clause)) return false;
    const directive = clause.replace(/^(?:(?:请(?:帮我)?|帮我|麻烦你?|现在|先|只|仅|直接)\s*)+/, "");
    if (/^(?:解释|介绍|说明|审阅|检查|分析原因|诊断|排查|查看|看一下|打开|发送|发给|下载)/i.test(directive)) {
      return /(?:并|再|然后|之后).{0,8}(?:制作|生成|输出|创建|修改|更新|重做|修复|优化|调整)/.test(directive);
    }
    return AUTHOR.test(clause) || (CHANGE.test(clause) && PAGE_CONTEXT.test(clause));
  };
  const explicitAction = clauses.some(hasCurrentAction);
  const advice = ADVICE.test(currentText)
    || /(?:怎么|如何|应该怎样|怎样才能).{0,16}(?:制作|做|生成|创建|输出|修复|使用|打开)/.test(currentText)
    || /(?:是什么|做什么|怎么用)[？?]?\s*$/.test(currentText);
  if (advice && !clauses.slice(1).some(hasCurrentAction)) return "";
  if (FILE_OPERATION.test(currentText) && !explicitAction) return "";
  if (!explicitAction && (SLIDE.test(currentText) || hasPowerPointAttachment || PAGE_CONTEXT.test(currentText))
    && /(?:丑|不好看|打不开|无法打开|失败|报错|卡住|崩溃|怎么回事)/.test(currentText)) return "";
  if (/(?:修复|排查|诊断).{0,20}(?:生成|制作|导出)?(?:失败|报错|功能|插件|代码|系统|工具).{0,8}(?:问题|原因|错误)?/.test(currentText)
    && !/(?:重新生成|重新制作|重做|重新导出)/.test(currentText)) return "";

  // A supplied “研究报告” is material, not a command to start unrelated research.
  // Only directive-shaped clauses leave the pending deck workflow.
  const unrelatedAction = !SLIDE.test(currentText) && !PAGE_CONTEXT.test(currentText)
    && clauses.some((clause) => {
      const directive = clause.replace(/^(?:(?:请(?:帮我)?|帮我|麻烦你?|现在|先|直接)\s*)+/, "");
      return /^(?:(?:研究|调研|分析)(?!报告|材料|深度|范围|对象|主题|结论|结果|内容|方法)|评级|评分|入库|建档|归档|写纪要|整理纪要|同步录音|处理录音|安排|预约|邀请|打开|发送|发给|下载|删除|移除|重命名|查找|搜索)/.test(directive)
        || /^(?:对|给|把|将).{1,50}(?:研究|调研|分析|评级|评分|入库|建档|归档|发送|发给|发我|下载|删除|移除|重命名)/.test(directive)
        || /^.{1,50}(?:纪要|文件|报告)(?:发我|发给|发送给|给我|下载)/.test(directive)
        || /^(?:(?:please|now)\s+)*(?:research(?!\s+(?:report|material))|analy[sz]e|rate|schedule|send|download)\b/i.test(directive);
    });
  const inputContinuation = awaitingSlidesInput && Boolean(previous) && !NEW_DECK.test(currentText)
    && !unrelatedAction
    && !/(?:取消|停止|先不做|换个|新任务|另一个任务|\bcancel\b|\bstop\b)/i.test(currentText);
  const contextualEdit = contextualRevisionIntent(currentText, previous) || inputContinuation;
  const hasSlide = SLIDE.test(currentText);
  const deliveryAsk = /(?:给我|要一份|需要一份|来一份|provide|deliver).{0,20}(?:slides?|pptx?|powerpoint|deck|幻灯片|演示文稿)/i.test(currentText);
  const authoring = explicitAction || deliveryAsk || contextualEdit;
  if (!authoring && !selectedSlides) return "";
  if (!hasSlide && !hasPowerPointAttachment && !contextualEdit && !selectedSlides) return "";
  // Preserve formatting on a contextual revision, but not on a new deck.
  const inherit = contextualEdit;
  const rejectPreserve = /(?:不要|不再|无需|不必|别|不)\s*保留|恢复默认(?:模板|主题)|改用.{0,12}(?:默认|Morgan Stanley|投行)/i.test(currentText);
  const preserve = !rejectPreserve && (PRESERVE.test(currentText) || (inherit && previous.endsWith("_preserve_template")));
  const pptx = !NO_PPTX.test(currentText) && (
    EDITABLE.test(currentText) || hasPowerPointAttachment || (inherit && previous.startsWith("explicit_pptx"))
  );
  return `${pptx ? "explicit_pptx" : "html_pdf"}${preserve ? "_preserve_template" : ""}`;
}
