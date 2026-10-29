export const newsDateLabel = (timestamp?: number | null): string =>
  typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
    ? new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "numeric", day: "numeric"
    }).format(timestamp)
    : "时间待补充";
