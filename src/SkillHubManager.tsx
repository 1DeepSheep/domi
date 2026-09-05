import {
  Check,
  Download,
  FilePlus2,
  RefreshCw,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { workbench } from "./bridge";
import type { SkillHubCandidate, SkillHubUserSkill, SkillHubOfficialSkill } from "./env";
import "./skill-hub-manager.css";

type SkillHubManagerProps = {
  onClose: () => void;
  onCreateSkill: () => void;
  onEditSkill: (skill: SkillHubUserSkill) => void;
  onImported: (skills: SkillHubUserSkill[]) => void;
  reviewCandidateIds?: string[];
};

export default function SkillHubManager({
  onClose,
  onCreateSkill,
  onEditSkill,
  onImported,
  reviewCandidateIds = []
}: SkillHubManagerProps) {
  const [candidates, setCandidates] = useState<SkillHubCandidate[]>([]);
  const [users, setUsers] = useState<SkillHubUserSkill[]>([]);
  const [official, setOfficial] = useState<SkillHubOfficialSkill[]>([]);
  const [details, setDetails] = useState<{ id: string; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(reviewCandidateIds.length
    ? "检测到新的本机 Skill。请勾选要加入 Skill Hub 的项目；其他任务创建的 Skill 不会自动导入。"
    : "");

  async function scan() {
    setLoading(true);
    setError("");
    try {
      const result = await workbench.scanSkillHub();
      if (!result.ok) throw new Error(result.error || "没有完成本机 Skill 扫描。");
      setCandidates(result.candidates);
      setUsers(result.imported);
      setOfficial(result.official || []);
      onImported(result.imported);
      setSelected((current) => new Set(
        [...current].filter((id) => result.candidates.some(
          (candidate) => candidate.id === id
            && candidate.status === "available"
            && !(candidate.sourceIsDestination && candidate.nameCollision)
        ))
      ));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void scan();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || importing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [importing, onClose]);

  const visibleCandidates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const matching = !normalized ? candidates : candidates.filter((candidate) => [
      candidate.title,
      candidate.name,
      candidate.description,
      candidate.sourceLabel
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized)));
    return [...matching].sort((left, right) => (
      Number(reviewCandidateIds.includes(right.id)) - Number(reviewCandidateIds.includes(left.id))
    ));
  }, [candidates, query, reviewCandidateIds]);

  const importableCount = candidates.filter((candidate) => (
    candidate.status === "available"
    && !(candidate.sourceIsDestination && candidate.nameCollision)
  )).length;

  function toggleCandidate(candidate: SkillHubCandidate) {
    if (
      candidate.status !== "available"
      || (candidate.sourceIsDestination && candidate.nameCollision)
      || importing
    ) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  }

  async function importSelected() {
    if (!selected.size || importing) return;
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const result = await workbench.importSkillHub({ candidateIds: [...selected] });
      if (result.skills) onImported(result.skills);
      if (!result.ok && !result.imported.length) {
        throw new Error(result.error || "所选 Skill 未能导入。");
      }
      const activationNotice = result.activation === "after-current-tasks"
        ? "当前任务结束后自动生效，不会中断正在运行的任务。"
        : "已生效，可在 Skill Hub 中直接使用。";
      setNotice(`已导入 ${result.imported.length} 个 Skill。${activationNotice}`);
      setSelected(new Set());
      await scan();
      if (result.failures?.length) {
        setError(result.failures.map((failure) => `${failure.title}：${failure.error}`).join("；"));
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImporting(false);
    }
  }

  async function manage(id: string, action: "fork" | "enable" | "details", enabled?: boolean) {
    if (importing) return;
    setImporting(true);
    setError("");
    try {
      const result = await workbench.manageSkillHub({ id, action, enabled });
      if (!result.ok) throw new Error(result.failures?.map((failure) => failure.error).join("；") || result.error || "操作未完成。");
      if (result.skills) onImported(result.skills);
      if (action === "details" && result.skill) {
        const skill = result.skill;
        setDetails({ id, text: [
          `保存位置：${skill.path}`, `来源：${skill.sourcePath}`,
          skill.independentCopy ? "独立副本：来源移动或软件升级不会覆盖它。" : "旧版原位注册：请保留上述目录；来源移动后需重新导入。",
          skill.sourceVersion ? `复制时官方版本：${skill.sourceVersion}；当前官方版本：${result.upstreamVersion || "不可用"}` : "来源：本机用户 Skill",
          result.baselineAvailable ? `相对导入时的文件差异：\n${result.changes?.join("\n") || "没有变化"}` : "旧版没有基线，不能准确计算文件差异。"
        ].join("\n") });
      } else {
        await scan();
        if (action === "fork" && result.imported?.[0]) onEditSkill(result.imported[0]);
        else setNotice(enabled ? "已在 Skill Hub 启用。" : "已从 Skill Hub 隐藏并禁止通过该入口启动；保留文件，不中断已开始的任务。Codex 原生发现不受此开关影响。");
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setImporting(false); }
  }

  const matches = (item: { title: string; description: string }) => `${item.title} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase());

  return (
    <div
      className="skill-hub-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !importing) onClose();
      }}
    >
      <section
        className="skill-hub-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-hub-title"
      >
        <header>
          <div>
            <span>SKILLS</span>
            <h2 id="skill-hub-title">管理 Skill Hub</h2>
            <p>官方 Skill 随 domi 更新；导入的用户 Skill 独立保存，软件升级不会覆盖。</p>
          </div>
          <button type="button" onClick={onClose} disabled={importing} aria-label="关闭 Skill Hub">
            <X size={17} />
          </button>
        </header>

        <div className="skill-hub-content">
          <button
            className="skill-hub-create"
            type="button"
            onClick={onCreateSkill}
            disabled={importing}
          >
            <span><Sparkles size={19} /></span>
            <div>
              <strong>新建 Skill</strong>
              <small>进入 Codex 对话，由原生 skill-creator 边聊边创建</small>
            </div>
            <FilePlus2 size={18} />
          </button>

          <div className="skill-hub-import-heading">
            <div>
              <strong>技能管理与本机导入</strong>
              <small>{loading ? "正在扫描…" : `${official.length} 个官方 · ${users.length} 个已加入 · ${importableCount} 个可从本机 Codex 导入${candidates.some((candidate) => candidate.status === "unavailable") ? " · 部分 Skill 需修复" : ""}`}</small>
            </div>
            <button type="button" onClick={() => void scan()} disabled={loading || importing}>
              <RefreshCw className={loading ? "spinning" : ""} size={14} />
              重新扫描
            </button>
          </div>

          <label className="skill-hub-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称或用途"
              aria-label="搜索本机 Skill"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                <X size={13} />
              </button>
            )}
          </label>

          <div className="skill-hub-list" aria-busy={loading}>
            {official.filter(matches).map((skill) => (
              <div className="skill-hub-managed-item" key={skill.id}>
                <div className="skill-hub-item-copy"><strong>{skill.title} <em>官方 · {skill.version}</em></strong><small>{skill.error || skill.description}</small>
                  {skill.integrity === "modified" && <small>与随软件打包的同版本内容不同。若是你的修改，请先复制保存，避免后续官方更新覆盖。</small>}
                </div>
                <button type="button" disabled={importing || Boolean(skill.error)} onClick={() => void manage(skill.id, "fork")}>复制并修改</button>
              </div>
            ))}
            {users.filter(matches).map((skill) => (
              <div className="skill-hub-managed-item" key={skill.id}>
                <div className="skill-hub-item-copy"><strong>{skill.title} <em>{skill.sourceVersion ? "官方派生" : "用户 Skill"} · {skill.enabled === false ? "已停用" : "已加入"}</em></strong><small>{skill.error || skill.description}</small></div>
                <div className="skill-hub-item-actions">
                  <button type="button" disabled={importing} onClick={() => onEditSkill(skill)}>编辑</button>
                  <button type="button" disabled={importing} onClick={() => void manage(skill.id, "enable", skill.enabled === false)}>{skill.enabled === false ? "启用" : "停用"}</button>
                  <button type="button" disabled={importing} onClick={() => details?.id === skill.id ? setDetails(null) : void manage(skill.id, "details")}>来源与差异</button>
                </div>
                {details?.id === skill.id && <pre className="skill-hub-details">{details.text}</pre>}
              </div>
            ))}
            {!loading && visibleCandidates.length === 0 && !users.some(matches) && !official.some(matches) && (
              <div className="skill-hub-empty">
                {query ? "没有匹配的 Skill" : "没有发现可导入的 Codex 用户 Skill"}
              </div>
            )}
            {visibleCandidates.filter((candidate) => candidate.status === "available").map((candidate) => {
              const checked = selected.has(candidate.id);
              const imported = candidate.status === "imported";
              const blocked = candidate.status === "unavailable"
                || (candidate.sourceIsDestination && candidate.nameCollision);
              return (
                <button
                  className={`skill-hub-item ${checked ? "selected" : ""}`}
                  type="button"
                  onClick={() => toggleCandidate(candidate)}
                  disabled={imported || blocked || importing}
                  aria-pressed={checked}
                  title={candidate.error || candidate.sourcePath}
                  key={candidate.id}
                >
                  <span className="skill-hub-check" aria-hidden="true">
                    {(checked || imported) && <Check size={13} />}
                  </span>
                  <span className="skill-hub-item-copy">
                    <strong>{candidate.title}</strong>
                    <small>{candidate.description}</small>
                    <em>
                      {candidate.sourceLabel}
                      {blocked
                        ? ` · ${candidate.error || `本机另有 $${candidate.name}，请先重命名`}`
                        : candidate.officialNameConflict
                        ? ` · 与 $domi:${candidate.name} 独立共存，导入为 $${candidate.suggestedName}`
                        : candidate.nameCollision
                          ? ` · 名称冲突，将作为 $${candidate.suggestedName} 导入`
                          : ` · $${candidate.name}`}
                    </em>
                  </span>
                  <span className={`skill-hub-status ${imported ? "imported" : ""}`}>
                    {imported ? "已加入" : blocked ? "需修复" : reviewCandidateIds.includes(candidate.id) ? "新发现" : "可导入"}
                  </span>
                </button>
              );
            })}
          </div>

          {notice && <div className="skill-hub-notice" role="status">{notice}</div>}
          {error && <div className="skill-hub-error" role="alert">{error}</div>}
        </div>

        <footer>
          <span>扫描 ~/.codex/skills 与 ~/.agents/skills；不会修改原 Skill。</span>
          <button
            className="skill-hub-import"
            type="button"
            onClick={() => void importSelected()}
            disabled={!selected.size || importing}
          >
            {importing
              ? <><RefreshCw className="spinning" size={15} />正在导入</>
              : <><Download size={15} />导入所选 {selected.size || ""}</>}
          </button>
        </footer>
      </section>
    </div>
  );
}
