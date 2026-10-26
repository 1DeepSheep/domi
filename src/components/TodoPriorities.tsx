import { useId } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { DomiTask } from "../env.d.ts";
import { selectTodoPriorities } from "../todo-priorities";
import "../todo-priorities.css";

export type TodoPrioritiesProps = {
  tasks: readonly DomiTask[];
  now: number;
  onExecute: (task: DomiTask) => void;
  busy?: boolean;
  busyTaskId?: string | null;
  subtitle?: string;
};

export default function TodoPriorities({
  tasks, now, onExecute, busy = false, busyTaskId = null, subtitle
}: TodoPrioritiesProps) {
  const titleId = useId();
  const priorities = selectTodoPriorities(tasks, now);
  return (
    <section className="todo-priorities" aria-labelledby={titleId}>
      <header className="todo-priorities-heading">
        <h2 id={titleId}>今天先做这几件事</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {priorities.length === 0 ? (
        <p className="todo-priorities-empty">当前没有未完成的待办。</p>
      ) : (
        <ol className="todo-priorities-list">
          {priorities.map(({ task, whyNow, nextAction }, index) => (
            <li className="todo-priority" key={task.id}>
              <span className="todo-priority-number" aria-hidden="true">{index + 1}</span>
              <div className="todo-priority-content">
                <h3>{task.title}</h3>
                <p className="todo-priority-reason">{whyNow}</p>
                <p className="todo-priority-action"><span>下一步</span>{nextAction}</p>
              </div>
              <button
                className="todo-priority-start"
                type="button"
                onClick={() => onExecute(task)}
                disabled={busy || Boolean(busyTaskId)}
                aria-label={`${task.status === "in_progress" ? "继续处理" : "开始处理"}：${task.title}`}
              >
                {busyTaskId === task.id
                  ? <RefreshCw className="spinning" size={14} />
                  : <ArrowRight size={14} />}
                {task.status === "in_progress" ? "继续处理" : "开始处理"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
