import { memo } from "react";
import { FileText } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttachmentNameContext } from "../shared/attachment-names.mjs";
import { remarkMessageFormatting, copyMessageSelection } from "./message-formatting";
import { workbench } from "./bridge";
import { isLocalMarkdownResource, isLocalPdfResource } from "./document-resources";
import { stripDomiEntityResultMarker } from "./entity-routing";
import {
  codexFileCitationPath,
  remarkCodexFileCitations
} from "./message-citations";
import { remarkCodexFollowups, type MessageFollowup } from "./message-followups";

type MessageContentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function humanizeMessageStates(content: string) {
  return content
    .replace(/`?context_pending`?/gi, "“等待补充信息”")
    .replace(/`?context_ready`?/gi, "“信息已补充”")
    .replace(/`?transcript_ready`?/gi, "“文字稿已就绪”")
    .replace(/`?notes_project`?/gi, "“项目纪要已生成”")
    .replace(/`?notes_non_project`?/gi, "“非项目纪要已生成”");
}

function remarkHumanizeMessageStates() {
  type Node = { type: string; value?: string; children?: Node[] };
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (["code", "inlineCode", "domiFollowup"].includes(node.type)) return;
      if (node.type === "text" && node.value) node.value = humanizeMessageStates(node.value);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const MessageContent = memo(function MessageContent({
  message,
  onOpenDocument,
  attachmentNameContext,
  onSelectFollowup,
  followupsDisabled = false
}: {
  message: MessageContentMessage;
  onOpenDocument: (resource: string) => void;
  attachmentNameContext?: AttachmentNameContext;
  onSelectFollowup?: (prompt: string) => void;
  followupsDisabled?: boolean;
}) {
  if (message.role !== "assistant") {
    return <div className="message-text">{message.content}</div>;
  }

  const displayContent = stripDomiEntityResultMarker(message.content);
  // Keep prompts outside DOM attributes and URLs. Only an explicit button
  // click can return one to the caller for editing in the draft composer.
  const followups = new Map<string, MessageFollowup>();

  return (
    <div className="message-text message-markdown" onCopy={copyMessageSelection}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkCodexFollowups, followups], [remarkCodexFileCitations, attachmentNameContext], remarkMessageFormatting, remarkHumanizeMessageStates]}
        urlTransform={(url, key, node) => {
          if (key === "href" && codexFileCitationPath(url)) return url;
          if (
            key === "href"
            && (isLocalMarkdownResource(url) || isLocalPdfResource(url))
          ) return url;
          return defaultUrlTransform(url);
        }}
        components={{
          button: ({ node, children }) => {
            const id = node?.properties["data-domi-followup-id"];
            const followup = typeof id === "string" ? followups.get(id) : undefined;
            if (!followup) return <span>{children}</span>;
            if (!onSelectFollowup) {
              return <span className="message-followup-label" title="后续建议">{followup.label}</span>;
            }
            return (
              <button
                type="button"
                className="message-followup"
                title="填入输入框，可编辑后发送"
                disabled={followupsDisabled}
                onClick={() => onSelectFollowup(followup.prompt)}
              >
                {followup.label}
              </button>
            );
          },
          table: ({ children, node: _node, ...props }) => (
            <div
              className="markdown-table-scroll"
              role="region"
              aria-label="表格，可左右滚动"
              tabIndex={0}
            >
              <table {...props}>{children}</table>
            </div>
          ),
          a: ({ href, children, title }) => {
            const citationPath = codexFileCitationPath(href);
            const target = citationPath || href || "";
            return (
              <a
                href={href}
                title={citationPath || title || href}
                className={citationPath ? "message-file-citation" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (!target) return;
                  if (isLocalMarkdownResource(target) || isLocalPdfResource(target)) {
                    onOpenDocument(target);
                  } else {
                    void workbench.openResource(target);
                  }
                }}
              >
                {citationPath && <FileText size={14} aria-hidden="true" />}
                <span>{children}</span>
              </a>
            );
          }
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}, (previous, next) => (
  previous.message === next.message
  && previous.attachmentNameContext === next.attachmentNameContext
  && previous.onOpenDocument === next.onOpenDocument
  && previous.onSelectFollowup === next.onSelectFollowup
  && previous.followupsDisabled === next.followupsDisabled
));

export default MessageContent;
