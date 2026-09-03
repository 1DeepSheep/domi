import { Extension } from "@tiptap/core";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import type { DOMOutputSpec, Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

function isUnderlinedEmphasis(node: ProseMirrorNode) {
  if (node.type.name !== "heading") return false;
  let hasText = false;
  let fullyUnderlined = true;
  node.forEach((child) => {
    if (child.isText && child.text?.trim()) {
      hasText = true;
      if (!child.marks.some((mark) => mark.type.name === "underline")) fullyUnderlined = false;
    } else if (!child.isText && child.type.name !== "hardBreak") {
      fullyUnderlined = false;
    }
  });
  return hasText && fullyUnderlined;
}

// Match the full-document exporter for legacy underlined emphasis headings.
// Transform only the clipboard slice; the saved document and ordinary headings
// retain their original structure, including links and all inline marks.
export function normalizeCopiedMarkdownSlice(slice: Slice, schema: Schema, originalHeadings?: ProseMirrorNode[]) {
  let headingIndex = 0;
  function normalize(node: ProseMirrorNode): ProseMirrorNode {
    const original = node.type.name === "heading" && originalHeadings
      ? originalHeadings[headingIndex++]
      : node;
    if (original && isUnderlinedEmphasis(original) && isUnderlinedEmphasis(node) && schema.nodes.paragraph && schema.marks.bold) {
      const bold = schema.marks.bold.create();
      const children: ProseMirrorNode[] = [];
      node.forEach((child) => children.push(child.isText ? child.mark(bold.addToSet(child.marks)) : child));
      return schema.nodes.paragraph.create(null, Fragment.fromArray(children));
    }
    if (node.isLeaf) return node;
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(normalize(child)));
    return node.copy(Fragment.fromArray(children));
  }
  const children: ProseMirrorNode[] = [];
  slice.content.forEach((node) => children.push(normalize(node)));
  return new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd);
}

function styledSpec(spec: DOMOutputSpec, style: string): DOMOutputSpec {
  if (!Array.isArray(spec)) return spec;
  const second = spec[1];
  const hasAttributes = second !== null && typeof second === "object" && !Array.isArray(second);
  const attributes = hasAttributes ? second as Record<string, unknown> : {};
  return [spec[0], { ...attributes, style: `${attributes.style || ""};${style}` }, ...spec.slice(hasAttributes ? 2 : 1)] as DOMOutputSpec;
}

export function portableMarkdownClipboardSerializer(schema: Schema) {
  const nodes = { ...DOMSerializer.nodesFromSchema(schema) };
  const table = nodes.table;
  if (table) nodes.table = (node) => {
    const spec = table(node);
    const unwrapped = Array.isArray(spec) && spec[0] === "div" && Array.isArray(spec[2]) && spec[2][0] === "table"
      ? ["table", ...spec[2].slice(1)] as DOMOutputSpec
      : spec;
    return styledSpec(unwrapped, "border-collapse:collapse;border:1px solid #ddd;");
  };
  for (const name of ["tableCell", "tableHeader"]) {
    const render = nodes[name];
    if (render) nodes[name] = (node) => styledSpec(render(node), "border:1px solid #ddd;padding:6px 9px;vertical-align:top;");
  }
  return new DOMSerializer(nodes, DOMSerializer.marksFromSchema(schema));
}

export const PortableMarkdownClipboard = Extension.create({
  name: "portableMarkdownClipboard",
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformCopied: (slice, view) => {
          const originalHeadings: ProseMirrorNode[] = [];
          view.state.doc.nodesBetween(view.state.selection.from, view.state.selection.to, (node) => {
            if (node.type.name === "heading") originalHeadings.push(node);
          });
          return normalizeCopiedMarkdownSlice(slice, this.editor.schema, originalHeadings);
        },
        clipboardSerializer: portableMarkdownClipboardSerializer(this.editor.schema)
      }
    })];
  }
});
