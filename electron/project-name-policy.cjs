"use strict";

// A legal suffix is a review signal, never a recipe for inventing a brand name.
function normalizedProjectName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•._\-—–（）()【】[\]{}，,。.!！?？/&／]+/g, "");
}

function isLegalEntityName(value) {
  const name = String(value || "").normalize("NFKC").trim();
  return /(?:股份有限公司|有限责任公司|有限公司|有限合伙企业|合伙企业\s*\(有限合伙\))$/.test(name)
    || /(?:^|[\s,.])(?:incorporated|corporation|limited|inc|corp|ltd|llc|llp|plc)\.?$/i.test(name);
}

function assertProjectBrandName(value, { previousName = "", allowLegalName = false } = {}) {
  if (!isLegalEntityName(value)
    || String(value).trim() === String(previousName).trim()
    || allowLegalName === true) return;
  const error = new Error(
    "项目名称应使用已确认的品牌或项目简称；法律主体全称请填写 legalName，并通过 aliases 保留别名。请核实简称，不要机械删除“科技”或地名。仅用户明确要求保留全称时，才可设置 allowLegalName:true。"
  );
  error.code = "DOMI_PROJECT_NAME_REVIEW_REQUIRED";
  throw error;
}

function projectNameAliases(name, values = []) {
  const seen = new Set([normalizedProjectName(name)]);
  const result = [];
  for (const value of values) {
    const alias = String(value || "").trim();
    const key = normalizedProjectName(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

module.exports = { normalizedProjectName, isLegalEntityName, assertProjectBrandName, projectNameAliases };
