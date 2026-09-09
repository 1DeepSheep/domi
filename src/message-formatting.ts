import { findLegacyUnderline } from "../shared/legacy-underline.mjs";

// Interpret only the two formatting tags supported by domi Markdown. Never
// enable arbitrary HTML, attributes, scripts or formatting inside code blocks.
type Node = {
  type: string; value?: string; children?: Node[]; depth?: number; url?: string;
  data?: { hName: string };
  position?: { start: { offset?: number }; end: { offset?: number } };
};
export function remarkMessageFormatting() {
  return (root: Node, file?: { value?: unknown }) => {
    const source = typeof file?.value === "string" ? file.value : null;
    function legacyText(node: Node, parent: Node): Node[] {
      const value = node.value || "";
      if (!value.includes("++")) return [node];
      if (parent.type === "link" && parent.url === value) return [node];
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      let prefix = "";
      if (source !== null && start !== undefined && end !== undefined) {
        // Remark has already decoded escapes and entities. Only map offsets
        // when source and text agree, so escaped literal ++ never gains a mark.
        if (source.slice(start, end) !== value) return [node];
        prefix = source.slice(parent.position?.start.offset ?? start, start);
      }
      const result: Node[] = [];
      let cursor = 0;
      for (;;) {
        const match = findLegacyUnderline(value, { fromIndex: cursor, prefix });
        if (!match) break;
        if (match.start > cursor) result.push({ type: "text", value: value.slice(cursor, match.start) });
        result.push({ type: "underline", data: { hName: "u" }, children: [{ type: "text", value: match.content }] });
        cursor = match.end;
      }
      if (!cursor) return [node];
      if (cursor < value.length) result.push({ type: "text", value: value.slice(cursor) });
      return result;
    }
    const fullyUnderlined = (node: Node): boolean => node.type === "underline"
      || Boolean(node.children?.length && node.children.every(fullyUnderlined))
      || (node.type === "text" && !node.value?.trim());
    function visit(parent: Node) {
      if (!parent.children) return;
      const output: Node[] = [];
      const stack: Node[][] = [output];
      for (const node of parent.children) {
        if (node.type !== "html") {
          visit(node);
          if (node.type === "text") {
            stack[stack.length - 1].push(...legacyText(node, parent));
            continue;
          }
          stack[stack.length - 1].push(node);
          continue;
        }
        for (const part of (node.value || "").split(/(<\/?u\s*>|<br\s*\/?\s*>)/gi).filter(Boolean)) {
          if (/^<u\s*>$/i.test(part)) {
            const underline: Node = { type: "underline", data: { hName: "u" }, children: [] };
            stack[stack.length - 1].push(underline);
            stack.push(underline.children!);
          } else if (/^<\/u\s*>$/i.test(part) && stack.length > 1) stack.pop();
          else if (/^<br\s*\/?\s*>$/i.test(part)) stack[stack.length - 1].push({ type: "break" });
          else stack[stack.length - 1].push({ type: "text", value: part });
        }
      }
      parent.children = output;
      if (parent.type === "heading" && (parent.depth ?? 1) <= 3 && output.length && output.every(fullyUnderlined)) {
        parent.type = "paragraph";
        parent.children = [{ type: "strong", children: output }];
      }
    }
    visit(root);
  };
}

export function copyMessageSelection(event: React.ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
  const container = document.createElement("div");
  let fragment: Node | DocumentFragment | HTMLElement = range.cloneContents();
  let ancestor = range.commonAncestorContainer.nodeType === window.Node.ELEMENT_NODE
    ? range.commonAncestorContainer as HTMLElement : range.commonAncestorContainer.parentElement;
  // cloneContents omits common formatting ancestors on partial selections.
  while (ancestor && ancestor !== event.currentTarget) {
    if (/^(U|STRONG|EM|S|CODE|P|H[1-6]|LI|UL|OL|TD|TH|TR|TBODY|THEAD|TABLE)$/.test(ancestor.tagName)) {
      const wrapper = ancestor.cloneNode(false) as HTMLElement;
      wrapper.append(fragment as DocumentFragment | HTMLElement);
      fragment = wrapper;
    }
    ancestor = ancestor.parentElement;
  }
  container.append(fragment as DocumentFragment | HTMLElement);
  for (const wrapper of container.querySelectorAll(".markdown-table-scroll")) wrapper.replaceWith(...wrapper.childNodes);
  for (const element of container.querySelectorAll<HTMLElement>("table, th, td, u")) {
    if (element.tagName === "TABLE") element.style.borderCollapse = "collapse";
    else if (element.tagName === "U") element.style.textDecoration = "underline";
    else { element.style.border = "1px solid #ddd"; element.style.padding = "6px 9px"; element.style.verticalAlign = "top"; }
  }
  event.clipboardData.setData("text/html", container.innerHTML);
  event.clipboardData.setData("text/plain", selection.toString());
  event.preventDefault();
}
