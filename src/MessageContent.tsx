import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { workbench } from "./bridge";
import { isLocalMarkdownResource, isLocalPdfResource } from "./document-resources";

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

const MessageContent = memo(function MessageContent({
  message,
  onOpenDocument
}: {
  message: MessageContentMessage;
  onOpenDocument: (resource: string) => void;
}) {
  if (message.role !== "assistant") {
    return <div className="message-text">{message.content}</div>;
  }

  const displayContent = humanizeMessageStates(message.content);

  return (
    <div className="message-text message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key, node) => {
          if (
            key === "href"
            && (isLocalMarkdownResource(url) || isLocalPdfResource(url))
          ) return url;
          return defaultUrlTransform(url);
        }}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              title={href}
              onClick={(event) => {
                event.preventDefault();
                if (!href) return;
                if (isLocalMarkdownResource(href) || isLocalPdfResource(href)) {
                  onOpenDocument(href);
                } else {
                  void workbench.openResource(href);
                }
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}, (previous, next) => previous.message === next.message);

export default MessageContent;
