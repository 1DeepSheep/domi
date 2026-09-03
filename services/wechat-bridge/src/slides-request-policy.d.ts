export const SLIDES_DELIVERY_POLICIES: Set<string>;
export function isContextualSlidesRevision(text: string, previousDeliveryPolicy?: string): boolean;
export function resolveSlidesDeliveryPolicy(options?: {
  text?: string;
  hasPowerPointAttachment?: boolean;
  previousDeliveryPolicy?: string;
  selectedSlides?: boolean;
  awaitingSlidesInput?: boolean;
}): string;
