export type MessageFollowup = { label: string; prompt: string };

type MessageAstNode = {
  type: string;
  children?: MessageAstNode[];
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

// This is a compatibility reader for completed assistant suggestions, not a
// general directive or HTML parser. Keep the entire paragraph contract strict.
export function parseMessageFollowup(source: string): MessageFollowup | null {
  if (source.length > 16_384) return null;
  const match = source.trim().match(
    /^:{1,2}codex-followup\[((?:[^\[\]\\\r\n]|\\[\[\]\\])+)\]\{[ \t]*prompt[ \t]*=[ \t]*("(?:[^"\\\r\n]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*")[ \t]*\}$/
  );
  if (!match) return null;
  const label = match[1].replace(/\\([\[\]\\])/g, "$1").trim();
  if (!label || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) return null;
  let prompt: string;
  try {
    prompt = JSON.parse(match[2]) as string;
  } catch {
    return null;
  }
  if (!prompt.trim() || prompt.length > 8_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt)) return null;
  return { label, prompt };
}

export function remarkCodexFollowups(followups: Map<string, MessageFollowup>) {
  return (tree: MessageAstNode, file?: { value?: unknown }) => {
    followups.clear();
    if (typeof file?.value !== "string") return;
    const source = file.value;
    const visit = (parent: MessageAstNode) => {
      // Quoted instructions, code, tables and HTML never become actions.
      if (!["root", "list", "listItem"].includes(parent.type)) return;
      for (const child of parent.children || []) {
        if (child.type !== "paragraph") {
          visit(child);
          continue;
        }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        if (start === undefined || end === undefined) continue;
        const followup = parseMessageFollowup(source.slice(start, end));
        if (!followup) continue;
        const id = String(followups.size);
        followups.set(id, followup);
        child.data = { hProperties: { className: ["message-followup-item"] } };
        child.children = [{
          type: "domiFollowup",
          data: { hName: "button", hProperties: { "data-domi-followup-id": id } },
          children: [{ type: "text", value: followup.label }]
        }];
        if (parent.type === "listItem" && parent.children?.length === 1) {
          parent.data = { hProperties: { className: ["message-followup-item"] } };
        }
      }
    };
    visit(tree);
  };
}
