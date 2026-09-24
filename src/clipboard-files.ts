type ClipboardDataLike = Pick<DataTransfer, "files" | "items">;

export function filesFromClipboardData(clipboardData: ClipboardDataLike): File[] {
  const directFiles = Array.from(clipboardData.files || []);
  if (directFiles.length > 0) return directFiles;

  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

// Finder can expose copied files as URLs instead of File objects. Only consume
// explicit local file URLs; ordinary text and web links remain normal paste.
export function filePathsFromClipboardData(clipboardData: Pick<DataTransfer, "getData">): string[] {
  return [...new Set(clipboardData.getData("text/uri-list")
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(value => value && !value.startsWith("#"))
    .flatMap(value => {
      try {
        const url = new URL(value);
        if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return [];
        const filePath = decodeURIComponent(url.pathname);
        return filePath && !filePath.includes("\0") ? [filePath] : [];
      } catch {
        return [];
      }
    }))];
}
