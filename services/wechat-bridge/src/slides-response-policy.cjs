// A clarification is not a finished deck. Keep this separate from artifact QA:
// recognizing a question must never produce a passed receipt or allow files out.
function isSlidesInputRequest(output) {
  const text = String(output || "").trim();
  if (!text || text.length > 1800) return false;
  // Any proposed delivery (including a broken link) must still take the QA path.
  if (/\[[^\]]*\]\s*\(|codex-file-citation|(?:https?:\/\/|file:|sandbox:)|(?:\/|\\)[^\n]*\.(?:html?|pdf|pptx)(?:\b|["'）)])|DOMI_SLIDES_QA_RECEIPT/i.test(text)) return false;
  if (/(?:已经?|现已)(?:全部)?(?:完成|生成|制作|导出|交付|通过)|(?:完成|生成|制作|导出)(?:了|完毕)|(?:deck|slides?|presentation)\s+(?:is\s+)?(?:ready|complete)|(?:have|has)\s+(?:created|generated|completed|exported)/i.test(text)) return false;
  const asksForInput = /(?:请(?:先|你|您|再)?(?:提供|上传|补充|确认|告诉|说明|选择)|需要(?:你|您)(?:先)?(?:提供|上传|补充|确认|告诉|说明)|能否(?:提供|上传|补充|告诉))|(?:please|could you|can you|need you to)\s+(?:provide|upload|share|confirm|specify|choose|tell)/i.test(text);
  const inputSubject = /(?:材料|附件|底稿|报告|主题|受众|页数|模板|文件|用途|目标|范围|数据|内容|audience|material|report|topic|template|file|data|source|scope)/i.test(text);
  const blocked = /(?:缺少|缺失|尚未(?:收到|提供|确定)|还没(?:收到|有)|未收到|没有(?:收到|可用|找到|提供)|请先|收到.{0,24}后|(?:提供|补充|确认).{0,24}后)|(?:missing|before I can|once you|after you|not (?:received|provided)|need (?:the|your))/i.test(text);
  return asksForInput && inputSubject && blocked;
}

module.exports = { isSlidesInputRequest };
