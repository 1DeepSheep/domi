type ClipboardDataLike = Pick<DataTransfer, "files" | "items">;

export function filesFromClipboardData(clipboardData: ClipboardDataLike): File[] {
  const directFiles = Array.from(clipboardData.files || []);
  if (directFiles.length > 0) return directFiles;

  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
