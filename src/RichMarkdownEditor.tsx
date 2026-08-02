import { Editor } from "@tiptap/core";
import TiptapImage from "@tiptap/extension-image";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  ChevronDown,
  ChevronUp,
  Code2,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Search,
  Undo2,
  X
} from "lucide-react";
import { workbench } from "./bridge";
import { prepareMarkdownForEditor, restoreMarkdownFromEditor } from "./markdownDialect";

type RichMarkdownEditorProps = {
  documentPath: string;
  markdown: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  onCopyDocument?: () => void;
};

const MARKDOWN_CHANGE_PUBLISH_DELAY_MS = 120;
const SEARCH_RESULT_HIGHLIGHT = "domi-markdown-search-result";
const SEARCH_CURRENT_HIGHLIGHT = "domi-markdown-search-current";

type EditorTextMatch = { from: number; to: number };
type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => boolean;
};

function findEditorTextMatches(editor: Editor | null, query: string): EditorTextMatch[] {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!editor || editor.isDestroyed || !editor.isInitialized || !needle) return [];
  let text = "";
  const positions: number[] = [];
  let previousEnd = -1;
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    if (previousEnd >= 0 && position > previousEnd) {
      text += "\n";
      positions.push(-1);
    }
    text += node.text;
    for (let index = 0; index < node.text.length; index += 1) {
      positions.push(position + index);
    }
    previousEnd = position + node.text.length;
  });

  const haystack = text.toLocaleLowerCase("zh-CN");
  const matches: EditorTextMatch[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length && matches.length < 5_000) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    const mapped = positions.slice(found, found + needle.length);
    if (
      mapped.length === needle.length
      && mapped.every((position) => position >= 0)
      && mapped.every((position, index) => index === 0 || position === mapped[index - 1] + 1)
    ) {
      matches.push({ from: mapped[0], to: mapped[mapped.length - 1] + 1 });
    }
    offset = found + Math.max(needle.length, 1);
  }
  return matches;
}

function searchHighlightRegistry() {
  const css = globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry };
  const HighlightConstructor = (globalThis as typeof globalThis & {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;
  return css?.highlights && HighlightConstructor
    ? { registry: css.highlights, HighlightConstructor }
    : null;
}

function clearEditorSearchHighlights() {
  const api = searchHighlightRegistry();
  api?.registry.delete(SEARCH_RESULT_HIGHLIGHT);
  api?.registry.delete(SEARCH_CURRENT_HIGHLIGHT);
}

function editorDomRange(editor: Editor, match: EditorTextMatch) {
  try {
    const start = editor.view.domAtPos(match.from);
    const end = editor.view.domAtPos(match.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function applyEditorSearchHighlights(
  editor: Editor | null,
  matches: EditorTextMatch[],
  currentIndex: number
) {
  clearEditorSearchHighlights();
  if (!editor || editor.isDestroyed || !editor.isInitialized || !matches.length) return;
  const ranges = matches.map((match) => editorDomRange(editor, match)).filter((range): range is Range => Boolean(range));
  const currentRange = editorDomRange(editor, matches[currentIndex] || matches[0]);
  const api = searchHighlightRegistry();
  if (api && ranges.length) {
    api.registry.set(SEARCH_RESULT_HIGHLIGHT, new api.HighlightConstructor(...ranges));
    if (currentRange) {
      api.registry.set(SEARCH_CURRENT_HIGHLIGHT, new api.HighlightConstructor(currentRange));
    }
  } else {
    const match = matches[currentIndex] || matches[0];
    editor.chain().setTextSelection(match).scrollIntoView().run();
  }
  const anchor = currentRange?.startContainer.nodeType === Node.TEXT_NODE
    ? currentRange.startContainer.parentElement
    : currentRange?.startContainer instanceof Element
      ? currentRange.startContainer
      : null;
  anchor?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

const EMPTY_TOOLBAR_STATE = {
  bold: false,
  italic: false,
  code: false,
  heading: false,
  blockquote: false,
  bulletList: false,
  orderedList: false,
  canUndo: false,
  canRedo: false
};

function readToolbarState(editor: Editor | null) {
  if (!editor || !editor.isInitialized || editor.isDestroyed) return EMPTY_TOOLBAR_STATE;

  try {
    return {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      code: editor.isActive("code"),
      heading: editor.isActive("heading", { level: 2 }),
      blockquote: editor.isActive("blockquote"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo()
    };
  } catch {
    // React can run one final selector pass while Tiptap is tearing down an editor.
    return EMPTY_TOOLBAR_STATE;
  }
}

function reportEditorOperation(operation: string, error: unknown) {
  const resolved = error instanceof Error ? error : new Error(String(error));
  console.error(`Markdown 编辑器操作失败：${operation}`, resolved);
  workbench.reportRendererIssue({
    kind: "markdown-editor-operation",
    message: `${operation}: ${resolved.message || "Markdown 编辑器操作失败"}`,
    stack: resolved.stack
  });
}

function runEditorCommand(
  editor: Editor | null,
  operation: string,
  command: (current: Editor) => void
) {
  if (!editor || !editor.isInitialized || editor.isDestroyed) return;
  try {
    command(editor);
  } catch (error) {
    // Event-handler errors are not caught by React error boundaries.
    reportEditorOperation(operation, error);
  }
}

function splitFrontmatter(markdown: string) {
  const match = markdown.match(/^(\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
  return {
    frontmatter: match?.[1] || "",
    body: match ? markdown.slice(match[1].length) : markdown
  };
}

function markdownImageExtension(documentPath: string) {
  return TiptapImage.extend({
    addNodeView() {
      return ({ node }) => {
        const image = document.createElement("img");
        image.draggable = false;
        let requestId = 0;

        const render = (source: string, alt?: string | null, title?: string | null) => {
          const currentRequestId = ++requestId;
          image.alt = alt || "Markdown 图片";
          image.title = title || "";
          image.dataset.state = "loading";
          image.removeAttribute("src");

          if (/^https?:\/\//i.test(source)) {
            image.src = source;
            image.dataset.state = "ready";
            return;
          }

          void workbench.resolveMarkdownImage({
            documentPath,
            source
          }).then((result) => {
            if (currentRequestId !== requestId) return;
            if (!result.ok || !result.previewUrl) {
              image.dataset.state = "error";
              image.title = result.error || "本地图片无法读取";
              return;
            }
            image.src = result.previewUrl;
            image.dataset.state = "ready";
          }).catch((error) => {
            if (currentRequestId !== requestId) return;
            image.dataset.state = "error";
            image.title = error instanceof Error ? error.message : "本地图片无法读取";
          });
        };

        render(String(node.attrs.src || ""), node.attrs.alt, node.attrs.title);
        return {
          dom: image,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false;
            render(
              String(updatedNode.attrs.src || ""),
              updatedNode.attrs.alt,
              updatedNode.attrs.title
            );
            return true;
          },
          selectNode() {
            image.classList.add("ProseMirror-selectednode");
          },
          deselectNode() {
            image.classList.remove("ProseMirror-selectednode");
          },
          destroy() {
            requestId += 1;
          }
        };
      };
    }
  }).configure({
    allowBase64: false
  });
}

function ToolbarButton({
  active = false,
  disabled = false,
  label,
  onClick,
  children
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function RichMarkdownToolbar({
  editor,
  searchOpen,
  onOpenSearch
}: {
  editor: Editor | null;
  searchOpen: boolean;
  onOpenSearch: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => readToolbarState(current)
  });
  const toolbarState = state || EMPTY_TOOLBAR_STATE;
  const editorAvailable = Boolean(editor && !editor.isDestroyed);

  return (
    <div className="rich-markdown-formatbar" aria-label="Markdown 格式工具">
      <div>
        <ToolbarButton
          active={toolbarState.heading}
          disabled={!editorAvailable}
          label="二级标题"
          onClick={() => runEditorCommand(editor, "切换二级标题", (current) => {
            current.chain().focus().toggleHeading({ level: 2 }).run();
          })}
        >
          <Heading2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.bold}
          disabled={!editorAvailable}
          label="粗体"
          onClick={() => runEditorCommand(editor, "切换粗体", (current) => {
            current.chain().focus().toggleBold().run();
          })}
        >
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.italic}
          disabled={!editorAvailable}
          label="斜体"
          onClick={() => runEditorCommand(editor, "切换斜体", (current) => {
            current.chain().focus().toggleItalic().run();
          })}
        >
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.code}
          disabled={!editorAvailable}
          label="行内代码"
          onClick={() => runEditorCommand(editor, "切换行内代码", (current) => {
            current.chain().focus().toggleCode().run();
          })}
        >
          <Code2 size={15} />
        </ToolbarButton>
        <span className="rich-markdown-divider" />
        <ToolbarButton
          active={toolbarState.blockquote}
          disabled={!editorAvailable}
          label="引用"
          onClick={() => runEditorCommand(editor, "切换引用", (current) => {
            current.chain().focus().toggleBlockquote().run();
          })}
        >
          <Quote size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.bulletList}
          disabled={!editorAvailable}
          label="项目列表"
          onClick={() => runEditorCommand(editor, "切换项目列表", (current) => {
            current.chain().focus().toggleBulletList().run();
          })}
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.orderedList}
          disabled={!editorAvailable}
          label="编号列表"
          onClick={() => runEditorCommand(editor, "切换编号列表", (current) => {
            current.chain().focus().toggleOrderedList().run();
          })}
        >
          <ListOrdered size={15} />
        </ToolbarButton>
      </div>
      <div>
        <ToolbarButton
          active={searchOpen}
          disabled={!editorAvailable}
          label="搜索文档（Ctrl/⌘+F）"
          onClick={onOpenSearch}
        >
          <Search size={15} />
        </ToolbarButton>
        <span className="rich-markdown-divider" />
        <ToolbarButton
          disabled={!editorAvailable || !toolbarState.canUndo}
          label="撤销"
          onClick={() => runEditorCommand(editor, "撤销", (current) => {
            current.chain().focus().undo().run();
          })}
        >
          <Undo2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!editorAvailable || !toolbarState.canRedo}
          label="重做"
          onClick={() => runEditorCommand(editor, "重做", (current) => {
            current.chain().focus().redo().run();
          })}
        >
          <Redo2 size={15} />
        </ToolbarButton>
      </div>
    </div>
  );
}

export default function RichMarkdownEditor({
  documentPath,
  markdown,
  onChange,
  onBlur,
  onCopyDocument
}: RichMarkdownEditorProps) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(markdown), [markdown]);
  const preparedBody = useMemo(() => prepareMarkdownForEditor(body), [body]);
  const imageExtension = useMemo(() => markdownImageExtension(documentPath), [documentPath]);
  const hydratingRef = useRef(true);
  const editorRef = useRef<Editor | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const changePublishTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchOpenRef = useRef(false);
  const searchQueryRef = useRef("");
  const searchMatchesRef = useRef<EditorTextMatch[]>([]);
  const searchIndexRef = useRef(0);
  const [imageNotice, setImageNotice] = useState<{ tone: "busy" | "success" | "error"; text: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<EditorTextMatch[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  onChangeRef.current = onChange;

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    if (changePublishTimerRef.current !== null) {
      window.clearTimeout(changePublishTimerRef.current);
    }
    clearEditorSearchHighlights();
  }, []);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "f") {
        event.preventDefault();
        setSearchOpen(true);
        searchOpenRef.current = true;
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      } else if (event.key === "Escape" && searchOpenRef.current) {
        event.preventDefault();
        setSearchOpen(false);
        searchOpenRef.current = false;
        clearEditorSearchHighlights();
      }
    };
    window.addEventListener("keydown", handleFindShortcut, true);
    return () => window.removeEventListener("keydown", handleFindShortcut, true);
  }, []);

  function refreshSearch(current: Editor | null, query: string, preferredIndex = 0) {
    const matches = findEditorTextMatches(current, query);
    const nextIndex = matches.length
      ? ((preferredIndex % matches.length) + matches.length) % matches.length
      : 0;
    searchQueryRef.current = query;
    searchMatchesRef.current = matches;
    searchIndexRef.current = nextIndex;
    setSearchQuery(query);
    setSearchMatches(matches);
    setSearchIndex(nextIndex);
    applyEditorSearchHighlights(current, matches, nextIndex);
  }

  function openSearch() {
    setSearchOpen(true);
    searchOpenRef.current = true;
    refreshSearch(editorRef.current, searchQueryRef.current, searchIndexRef.current);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }

  function closeSearch() {
    setSearchOpen(false);
    searchOpenRef.current = false;
    clearEditorSearchHighlights();
  }

  function moveSearch(direction: 1 | -1) {
    const matches = searchMatchesRef.current;
    if (!matches.length) return;
    const nextIndex = (searchIndexRef.current + direction + matches.length) % matches.length;
    searchIndexRef.current = nextIndex;
    setSearchIndex(nextIndex);
    applyEditorSearchHighlights(editorRef.current, matches, nextIndex);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function publishEditorMarkdown(current = editorRef.current) {
    if (!current || current.isDestroyed || !current.isInitialized) return;
    if (changePublishTimerRef.current !== null) {
      window.clearTimeout(changePublishTimerRef.current);
      changePublishTimerRef.current = null;
    }
    try {
      onChangeRef.current(
        `${frontmatter}${restoreMarkdownFromEditor(current.getMarkdown())}`
      );
    } catch (error) {
      reportEditorOperation("序列化 Markdown", error);
    }
  }

  function scheduleEditorMarkdownPublish() {
    if (changePublishTimerRef.current !== null) {
      window.clearTimeout(changePublishTimerRef.current);
    }
    changePublishTimerRef.current = window.setTimeout(() => {
      changePublishTimerRef.current = null;
      publishEditorMarkdown();
    }, MARKDOWN_CHANGE_PUBLISH_DELAY_MS);
  }

  function showImageNotice(
    tone: "busy" | "success" | "error",
    text: string,
    autoDismiss = true
  ) {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setImageNotice({ tone, text });
    noticeTimerRef.current = autoDismiss
      ? window.setTimeout(() => setImageNotice(null), tone === "error" ? 5_000 : 2_600)
      : null;
  }

  async function insertPastedImages(files: File[], insertionPosition: number) {
    showImageNotice("busy", `正在保存 ${files.length} 张图片…`, false);
    const assets: Array<{ relativePath: string; alt: string }> = [];
    const errors: string[] = [];

    for (const [index, file] of files.entries()) {
      try {
        const result = await workbench.saveMarkdownImage({
          documentPath,
          name: file.name || `clipboard-image-${index + 1}`,
          type: file.type,
          data: await file.arrayBuffer()
        });
        if (!result.ok || !result.asset) {
          errors.push(result.error || `第 ${index + 1} 张图片保存失败`);
          continue;
        }
        assets.push({
          relativePath: result.asset.relativePath,
          alt: file.name?.replace(/\.[^.]+$/, "") || "粘贴图片"
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `第 ${index + 1} 张图片保存失败`);
      }
    }

    const current = editorRef.current;
    if (assets.length && current && current.isInitialized && !current.isDestroyed) {
      try {
        const position = Math.max(1, Math.min(insertionPosition, current.state.doc.content.size));
        const content = assets.flatMap((asset, index) => [
          {
            type: "image",
            attrs: {
              src: asset.relativePath,
              alt: asset.alt
            }
          },
          ...(index === assets.length - 1 ? [{ type: "paragraph" }] : [])
        ]);
        current.chain().focus().setTextSelection(position).insertContent(content).run();
      } catch (error) {
        reportEditorOperation("插入 Markdown 图片", error);
        showImageNotice("error", "图片已保存，但插入正文失败");
        return;
      }
    }

    if (errors.length) {
      showImageNotice(
        "error",
        assets.length
          ? `已插入 ${assets.length} 张，${errors.length} 张失败：${errors[0]}`
          : errors[0]
      );
    } else {
      showImageNotice("success", `已插入 ${assets.length} 张图片`);
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["domi-wiki", "domi-callout"]
        }
      }),
      TableKit.configure({
        table: { resizable: false }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      imageExtension,
      Markdown.configure({
        markedOptions: { gfm: true, breaks: false }
      })
    ],
    content: preparedBody,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "rich-markdown-content",
        spellcheck: "false"
      },
      handlePaste: (view, event) => {
        const imageFiles = Array.from(event.clipboardData?.items || [])
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));
        if (!imageFiles.length) return false;
        event.preventDefault();
        void insertPastedImages(imageFiles, view.state.selection.from);
        return true;
      },
      handleDOMEvents: {
        copy: (view, event) => {
          if (!onCopyDocument) return false;
          const { from, to } = view.state.selection;
          const coversDocument = from <= 1 && to >= view.state.doc.content.size - 1;
          let containsImage = false;
          view.state.doc.descendants((node) => {
            if (node.type.name === "image") containsImage = true;
            return !containsImage;
          });
          if (!coversDocument || !containsImage) return false;
          event.preventDefault();
          publishEditorMarkdown();
          onCopyDocument();
          return true;
        }
      }
    },
    onCreate: ({ editor: current }) => {
      if (!current.isDestroyed) {
        editorRef.current = current;
        hydratingRef.current = false;
      }
    },
    onDestroy: () => {
      editorRef.current = null;
      hydratingRef.current = true;
    },
    onUpdate: ({ editor: current }) => {
      if (hydratingRef.current || current.isDestroyed) return;
      scheduleEditorMarkdownPublish();
      if (searchOpenRef.current && searchQueryRef.current) {
        refreshSearch(current, searchQueryRef.current, searchIndexRef.current);
      }
    }
  });

  return (
    <div
      className="rich-markdown-editor"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        publishEditorMarkdown();
        onBlur?.();
      }}
    >
      <RichMarkdownToolbar editor={editor} searchOpen={searchOpen} onOpenSearch={openSearch} />
      {searchOpen && (
        <div className="rich-markdown-search" role="search" aria-label="搜索 Markdown 文档">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            placeholder="搜索文档"
            aria-label="搜索关键词"
            spellCheck={false}
            onChange={(event) => refreshSearch(editorRef.current, event.target.value, 0)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                moveSearch(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
          />
          <span className="rich-markdown-search-count" aria-live="polite">
            {searchQuery.trim() ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : ""}
          </span>
          <button type="button" onClick={() => moveSearch(-1)} disabled={!searchMatches.length} title="上一个匹配">
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={() => moveSearch(1)} disabled={!searchMatches.length} title="下一个匹配">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={closeSearch} title="关闭搜索" aria-label="关闭搜索">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="rich-markdown-scroll">
        <EditorContent editor={editor} />
      </div>
      {imageNotice && (
        <div className={`markdown-image-notice ${imageNotice.tone}`} role="status">
          {imageNotice.text}
        </div>
      )}
    </div>
  );
}
