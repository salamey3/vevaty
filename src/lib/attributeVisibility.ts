import { AttributeValue, CategoryAttribute } from '../types';

// Generic "field depends on another field's value" mechanism, driven
// entirely by CategoryAttribute.dependsOnSlug/dependsOnValues (set in the
// DB, resolved in SettingsStore's dbToCategoryAttribute). An attribute
// with no dependency is always visible; one with a dependency is only
// visible once the referenced attribute (by slug, within the same
// resolved list) currently holds one of the listed values. Built for
// Properties' Property Type -> Bedrooms/Bathrooms/etc relationship, but
// deliberately category-agnostic so any future category can use it too.
//
// Filtering the shared specAttrs list through this once, at its source
// in CreateListingScreen.tsx and BatchDetailsScreen.tsx, is the single
// choke point: everything already downstream of specAttrs (spec-line
// building, the AI-suggestion schema, payload building, required-field
// validation, the review-step summary) automatically respects field
// visibility with no further changes.
export function resolveVisibleAttrs(
  attrs: CategoryAttribute[],
  attrValues: Record<string, AttributeValue>
): CategoryAttribute[] {
  return attrs.filter((a) => {
    if (!a.dependsOnSlug || !a.dependsOnValues) return true;
    const v = attrValues[a.dependsOnSlug];
    return typeof v === 'string' && a.dependsOnValues.includes(v);
  });
}
