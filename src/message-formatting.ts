// Interpret only the two formatting tags supported by domi Markdown. Never
// enable arbitrary HTML, attributes, scripts or formatting inside code blocks.
type Node = { type: string; value?: string; children?: Node[]; data?: { hName: string } };
export function remarkMessageFormatting() {
  return (root: Node) => {
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
          if (node.type === "text" && /\+\+[^\n]+\+\+/.test(node.value || "")) {
            for (const [index, part] of (node.value || "").split(/\+\+([^\n]+?)\+\+/g).entries()) {
              stack[stack.length - 1].push(index % 2 ? { type: "underline", data: { hName: "u" }, children: [{ type: "text", value: part }] } : { type: "text", value: part });
            }
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
      if (parent.type === "heading" && output.length && output.every(fullyUnderlined)) {
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
