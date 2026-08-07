import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CodexUserInputAnswerResult,
  CodexUserInputQuestion,
  CodexUserInputRequest
} from "./env";

type AssistantChoiceCardProps = {
  request: CodexUserInputRequest;
  resolved?: boolean;
  onSubmit: (
    answers: Record<string, string[]>
  ) => Promise<CodexUserInputAnswerResult>;
};

const OTHER_VALUE = "__domi_other__";

function isQuestionComplete(
  question: CodexUserInputQuestion,
  selected: string | undefined,
  otherValue: string | undefined
) {
  if (!selected) return false;
  return selected !== OTHER_VALUE || Boolean(otherValue?.trim());
}

export default function AssistantChoiceCard({
  request,
  resolved = false,
  onSubmit
}: AssistantChoiceCardProps) {
  const questions = useMemo(() => request.questions.slice(0, 3), [request.questions]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [otherValues, setOtherValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const effectiveResolved = resolved || submitted;

  function answersFromState(
    nextSelected = selected,
    nextOtherValues = otherValues
  ) {
    return Object.fromEntries(questions.map((question) => {
      const value = nextSelected[question.id];
      return [question.id, [
        value === OTHER_VALUE
          ? (nextOtherValues[question.id] || "").trim()
          : (value || "").trim()
      ].filter(Boolean)];
    }));
  }

  async function submit(
    nextSelected = selected,
    nextOtherValues = otherValues
  ) {
    if (submitting || effectiveResolved) return;
    const complete = questions.every((question) =>
      isQuestionComplete(
        question,
        nextSelected[question.id],
        nextOtherValues[question.id]
      )
    );
    if (!complete) {
      setError("请先完成当前选择。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await onSubmit(answersFromState(nextSelected, nextOtherValues));
      if (!result.ok) {
        setError(result.error || "暂时无法提交，请重试。");
        return;
      }
      setSubmitted(true);
      // Secret answers may remain in React input state while this card is mounted,
      // but are never copied into thread messages or persisted application state.
      if (questions.some((question) => question.isSecret)) {
        setOtherValues({});
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暂时无法提交，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function choose(question: CodexUserInputQuestion, value: string) {
    if (submitting || effectiveResolved) return;
    const nextSelected = { ...selected, [question.id]: value };
    setSelected(nextSelected);
    setError("");
    const isImmediateChoice = questions.length === 1 && value !== OTHER_VALUE;
    if (isImmediateChoice) void submit(nextSelected, otherValues);
  }

  if (!questions.length) return null;

  return (
    <section className={`assistant-choice-card ${effectiveResolved ? "resolved" : ""}`}>
      {questions.map((question, questionIndex) => {
        const current = selected[question.id];
        return (
          <div className="assistant-choice-question" key={question.id}>
            <div className="assistant-choice-heading">
              <span>{question.header || `选择 ${questionIndex + 1}`}</span>
              {questions.length > 1 && <small>{questionIndex + 1}/{questions.length}</small>}
            </div>
            <p>{question.question}</p>
            {question.options?.length ? (
              <div className="assistant-choice-options" role="radiogroup" aria-label={question.question}>
                {question.options.slice(0, 3).map((option, optionIndex) => {
                  const recommended = optionIndex === 0 && /推荐/.test(option.label);
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={current === option.label}
                      className={current === option.label ? "selected" : ""}
                      disabled={submitting || effectiveResolved}
                      onClick={() => choose(question, option.label)}
                      key={option.label}
                    >
                      <span>
                        <strong>{option.label.replace(/\s*[（(]推荐[）)]\s*$/, "")}</strong>
                        {recommended && <em>推荐</em>}
                        {option.description && <small>{option.description}</small>}
                      </span>
                      {current === option.label ? <Check size={16} /> : <ChevronRight size={16} />}
                    </button>
                  );
                })}
                {question.isOther && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={current === OTHER_VALUE}
                    className={current === OTHER_VALUE ? "selected" : ""}
                    disabled={submitting || effectiveResolved}
                    onClick={() => choose(question, OTHER_VALUE)}
                  >
                    <span><strong>其他</strong><small>输入自己的答案</small></span>
                    {current === OTHER_VALUE ? <Check size={16} /> : <ChevronRight size={16} />}
                  </button>
                )}
              </div>
            ) : (
              <input
                className="assistant-choice-input"
                type={question.isSecret ? "password" : "text"}
                value={otherValues[question.id] || ""}
                disabled={submitting || effectiveResolved}
                placeholder="输入答案"
                autoComplete="off"
                onChange={(event) => {
                  setSelected((currentSelected) => ({
                    ...currentSelected,
                    [question.id]: OTHER_VALUE
                  }));
                  setOtherValues((currentValues) => ({
                    ...currentValues,
                    [question.id]: event.target.value
                  }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && questions.length === 1) void submit();
                }}
              />
            )}
            {current === OTHER_VALUE && question.options?.length ? (
              <input
                className="assistant-choice-input"
                type={question.isSecret ? "password" : "text"}
                value={otherValues[question.id] || ""}
                disabled={submitting || effectiveResolved}
                placeholder="输入其他答案"
                autoComplete="off"
                onChange={(event) => setOtherValues((currentValues) => ({
                  ...currentValues,
                  [question.id]: event.target.value
                }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && questions.length === 1) void submit();
                }}
              />
            ) : null}
          </div>
        );
      })}
      {!effectiveResolved && (questions.length > 1 || questions.some((question) => !question.options?.length || selected[question.id] === OTHER_VALUE)) && (
        <button
          type="button"
          className="assistant-choice-continue"
          disabled={submitting || !questions.every((question) =>
            isQuestionComplete(question, selected[question.id], otherValues[question.id])
          )}
          onClick={() => void submit()}
        >
          {submitting ? <LoaderCircle className="spinning" size={16} /> : null}
          继续
        </button>
      )}
      {effectiveResolved && (
        <div className="assistant-choice-resolved"><Check size={15} />已选择，domi 正在继续</div>
      )}
      {!effectiveResolved && request.autoResolutionMs ? (
        <small className="assistant-choice-auto">未选择时，domi 将在稍后继续判断。</small>
      ) : null}
      {error && <div className="assistant-choice-error">{error}</div>}
    </section>
  );
}
