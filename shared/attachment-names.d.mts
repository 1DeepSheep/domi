export interface AttachmentNameContext {
  managedRoots?: readonly string[];
  attachments?: readonly { path: string; name: string }[];
  /** Directory used to resolve relative local links. */
  basePath?: string;
}
export function attachmentDisplayName(rawPath: string, context?: AttachmentNameContext): string;
export function attachmentPathLabel(rawPath: string, label: string | undefined, context?: AttachmentNameContext): string;
export function attachmentLinkLabel(resource: string, label: string | undefined, context?: AttachmentNameContext): string;
export function attachmentPrompt(files: readonly { path: string; name: string }[]): string;
