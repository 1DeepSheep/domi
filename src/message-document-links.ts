type Node = {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const DOCUMENT_END = /\.(?:md|markdown|pdf|docx?|xlsx?|pptx?|txt|csv|json)(?::\d+(?::\d+)?)?$/i;
const DELIMITER_AFTER_LINK = /^[\s.,;:!?，。；：！？、\]}]/;

function unfinishedLocalTarget(value: string, start: number) {
  // Recover only the observed missing `>` in an explicit angle destination.
  // Never guess a bare path, web URL, relative path or an incomplete stream.
  const tail = value.slice(start);
  if (!/^(?:\/(?!\/)|~\/|file:\/\/(?:localhost)?\/)/i.test(tail)) return null;
  let parentheses = 0;
  for (let end = start; end < Math.min(value.length, start + 8_192); end += 1) {
    const character = value[end];
    if (/[<>\[\]\\\u0000-\u001f\u007f]/.test(character)) return null;
    if (character === "(") parentheses += 1;
    if (character !== ")") continue;
    if (parentheses > 0) {
      parentheses -= 1;
      continue;
    }
    const target = value.slice(start, end);
    if (!DOCUMENT_END.test(target) || (end + 1 < value.length && !DELIMITER_AFTER_LINK.test(value[end + 1]))) return null;
    return { target, end: end + 1 };
  }
  return null;
}

export function remarkRepairLocalDocumentLinks() {
  return (tree: Node, file?: { value?: unknown }) => {
    if (typeof file?.value !== "string") return;
    const source = file.value;
    const visit = (parent: Node) => {
      if (["link", "linkReference", "image", "imageReference", "code", "inlineCode", "html"].includes(parent.type) || !parent.children) return;
      parent.children = parent.children.flatMap((node): Node[] => {
        if (node.type !== "text" || !node.value?.includes("](<")) {
          visit(node);
          return [node];
        }
        const value = node.value;
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        // Source agreement protects escaped examples and entity-encoded text.
        if (start === undefined || end === undefined || source.slice(start, end) !== value) return [node];
        const output: Node[] = [];
        let cursor = 0;
        for (const match of value.matchAll(/\[([^\[\]\r\n]{1,200})\]\(</g)) {
          const index = match.index ?? 0;
          if (index < cursor || value[index - 1] === "!") continue;
          const recovered = unfinishedLocalTarget(value, index + match[0].length);
          if (!recovered) continue;
          if (index > cursor) output.push({ type: "text", value: value.slice(cursor, index) });
          output.push({ type: "link", url: recovered.target, children: [{ type: "text", value: match[1] }] });
          cursor = recovered.end;
        }
        if (!cursor) return [node];
        if (cursor < value.length) output.push({ type: "text", value: value.slice(cursor) });
        return output;
      });
    };
    visit(tree);
  };
}
