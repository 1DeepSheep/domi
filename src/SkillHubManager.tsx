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
import type { SkillHubCandidate, SkillHubUserSkill } from "./env";
import "./skill-hub-manager.css";

type SkillHubManagerProps = {
  onClose: () => void;
  onCreateSkill: () => void;
  onImported: (skills: SkillHubUserSkill[]) => void;
  reviewCandidateIds?: string[];
};

export default function SkillHubManager({
  onClose,
  onCreateSkill,
  onImported,
  reviewCandidateIds = []
}: SkillHubManagerProps) {
  const [candidates, setCandidates] = useState<SkillHubCandidate[]>([]);
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
              <strong>从本机 Codex 导入</strong>
              <small>{loading ? "正在扫描…" : `${importableCount} 个可导入 · ${candidates.filter((candidate) => candidate.status === "imported").length} 个已加入${candidates.some((candidate) => candidate.status === "unavailable") ? " · 部分 Skill 需修复" : ""}`}</small>
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
            {!loading && visibleCandidates.length === 0 && (
              <div className="skill-hub-empty">
                {query ? "没有匹配的 Skill" : "没有发现可导入的 Codex 用户 Skill"}
              </div>
            )}
            {visibleCandidates.map((candidate) => {
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
