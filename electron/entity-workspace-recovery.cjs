function errorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  return String(error).trim();
}

function conflictLike(message) {
  return /(?:多个|不止一个|重复|冲突|歧义|duplicate|ambiguous|more than one)/i.test(
    String(message || "")
  );
}

function actionableEntityWorkspaceError(message = "") {
  const detail = errorMessage(message);
  if (conflictLike(detail)) {
    return [
      "检测到同一项目或人物记录对应多个本地目录，domi 已停止自动关联以避免写错资料。",
      "请在资料库中确认并保留唯一的实体目录，再重新同步后重试。",
      detail ? `详细信息：${detail}` : ""
    ].filter(Boolean).join("\n");
  }
  return [
    "domi 未能唯一确认当前项目或人物的本地目录。",
    "如果刚修改过文件夹名称，请确认资料库目录可访问后重新同步；如果存在重复目录，请先指定或保留唯一目录。",
    detail ? `详细信息：${detail}` : ""
  ].filter(Boolean).join("\n");
}

async function resolveEntityWorkspaceWithRecovery({
  request,
  resolveWorkspace,
  validateWorkspace,
  reindex
}) {
  if (typeof resolveWorkspace !== "function" || typeof validateWorkspace !== "function") {
    throw new TypeError("实体目录解析器配置不完整。");
  }

  let initialCandidate = "";
  let initialWorkspace = "";
  try {
    initialCandidate = resolveWorkspace(request) || "";
    initialWorkspace = validateWorkspace(initialCandidate) || "";
  } catch (error) {
    return {
      ok: false,
      recovered: false,
      error: actionableEntityWorkspaceError(error)
    };
  }
  if (initialWorkspace) {
    return {
      ok: true,
      recovered: false,
      workspacePath: initialWorkspace
    };
  }

  if (typeof reindex !== "function") {
    return {
      ok: false,
      recovered: false,
      error: actionableEntityWorkspaceError()
    };
  }

  let reindexResult;
  try {
    // A missing canonical directory gets exactly one repair attempt. The
    // repository owns identity matching; this boundary never guesses by name.
    reindexResult = await reindex();
    if (reindexResult?.ok === false || reindexResult?.stale) {
      return {
        ok: false,
        recovered: false,
        error: actionableEntityWorkspaceError(
          reindexResult.error || "资料库重建索引没有返回可验证的新结果。"
        )
      };
    }
  } catch (error) {
    return {
      ok: false,
      recovered: false,
      error: actionableEntityWorkspaceError(error)
    };
  }

  try {
    const recoveredWorkspace = validateWorkspace(resolveWorkspace(request) || "") || "";
    if (!recoveredWorkspace) {
      return {
        ok: false,
        recovered: false,
        reindexResult,
        error: actionableEntityWorkspaceError(
          "重新建立索引后仍没有找到唯一且可访问的目录。"
        )
      };
    }
    return {
      ok: true,
      recovered: true,
      workspacePath: recoveredWorkspace,
      reindexResult
    };
  } catch (error) {
    return {
      ok: false,
      recovered: false,
      reindexResult,
      error: actionableEntityWorkspaceError(error)
    };
  }
}

module.exports = {
  actionableEntityWorkspaceError,
  resolveEntityWorkspaceWithRecovery
};
