import { AttributeValue, CategoryAttribute } from '../types';

// Client-side re-check of one AI-suggested attribute value against its real
// definition -- defense in depth on top of the edge function's own
// (authoritative) validation, using the same rules: unparseable/out-of-range
// values are dropped, never coerced (e.g. a bad number must NOT become 0 --
// that can be a real, wrong value). Returns undefined when the value
// shouldn't be applied.
//
// Extracted out of CreateListingScreen.tsx's applyAiSuggestion (moved
// unchanged) so useAiSpecSuggestion.ts -- and, through it, the batch
// flow's per-item spec-fill -- can reuse the exact same rules instead of a
// second copy that could quietly drift from this one.
export function validateAiAttributeValue(attribute: CategoryAttribute, value: unknown): AttributeValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (attribute.type === 'text') {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 80 ? value.trim() : undefined;
  }
  if (attribute.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  if (attribute.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (attribute.type === 'select') {
    return typeof value === 'string' && attribute.options.some((o) => o.value === value) ? value : undefined;
  }
  if (attribute.type === 'multiselect') {
    if (!Array.isArray(value)) return undefined;
    const valid = value.filter((v): v is string => typeof v === 'string' && attribute.options.some((o) => o.value === v));
    return valid.length > 0 ? valid : undefined;
  }
  return undefined;
}
