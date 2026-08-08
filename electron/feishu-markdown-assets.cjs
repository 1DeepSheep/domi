function responseData(response) {
  const first = response?.data ?? response ?? {};
  return first?.data ?? first;
}

function nestedObjects(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => nestedObjects(item, seen));
  return [value, ...Object.values(value).flatMap((item) => nestedObjects(item, seen))];
}

function insertedBlockId(response) {
  for (const value of nestedObjects(responseData(response))) {
    const blockId = String(value?.block_id || value?.blockId || "").trim();
    if (blockId) return blockId;
  }
  return "";
}

function markerBlockId(response, marker) {
  const data = responseData(response);
  const document = data?.document || data?.doc || data;
  const content = String(document?.content || "");
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return "";
  const excerptStart = content.lastIndexOf("<excerpt", markerIndex);
  if (excerptStart >= 0) {
    const opening = content.slice(excerptStart, content.indexOf(">", excerptStart) + 1);
    const topBlockId = opening.match(/\btop-block-id="([^"]+)"/)?.[1];
    if (topBlockId) return topBlockId;
  }
  const beforeMarker = content.slice(0, markerIndex);
  const candidates = [...beforeMarker.matchAll(/<(?:p|blockquote|li|h[1-9])\b[^>]*\bid="([^"]+)"[^>]*>/gi)];
  return candidates.at(-1)?.[1] || "";
}

async function placeFeishuAssetAtMarker({ runLark, documentId, asset }) {
  const located = await runLark([
    "docs", "+fetch", "--doc", documentId,
    "--scope", "keyword", "--keyword", asset.marker,
    "--detail", "with-ids", "--format", "json"
  ], { timeout: 120000 });
  const anchorBlockId = markerBlockId(located, asset.marker);
  if (!anchorBlockId) throw new Error(`飞书回读未找到图片“${asset.caption}”的原位锚点。`);

  const inserted = await runLark([
    "docs", "+media-insert", "--doc", documentId,
    "--file", asset.path, "--type", "image",
    "--caption", asset.caption, "--align", "center", "--format", "json"
  ], { timeout: 180000 });
  const imageBlockId = insertedBlockId(inserted);
  if (!imageBlockId) throw new Error(`飞书上传图片“${asset.caption}”后没有返回图片 block ID。`);

  await runLark([
    "docs", "+update", "--doc", documentId,
    "--command", "block_move_after", "--block-id", anchorBlockId,
    "--src-block-ids", imageBlockId, "--format", "json"
  ], { timeout: 120000 });
  await runLark([
    "docs", "+update", "--doc", documentId,
    "--command", "block_delete", "--block-id", anchorBlockId,
    "--format", "json"
  ], { timeout: 120000 });
  return { anchorBlockId, imageBlockId };
}

module.exports = {
  insertedBlockId,
  markerBlockId,
  placeFeishuAssetAtMarker
};
