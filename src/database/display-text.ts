const DATABASE_LINE_BREAK_TAG = /<br\s*\/?>/gi;

/**
 * Treat the narrow set of HTML break spellings found in imported table data as
 * visual line breaks. All other markup stays plain text and is escaped by React.
 */
export function formatDatabaseCellDisplayText(value: unknown) {
  if (value == null) return "";
  return String(value).replace(DATABASE_LINE_BREAK_TAG, "\n");
}
