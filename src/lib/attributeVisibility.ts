import { AttributeValue, CategoryAttribute, Listing } from '../types';

// The one slug that doesn't name another attribute. An attribute whose
// dependsOnSlug is this depends on the LISTING's own condition field --
// New/Used for most categories, Sale/Rent/Both for Properties and Vehicles, For sale/Free for live animals -- rather
// than on a sibling spec. Prefixed so it can never collide with a real
// attribute slug, which are plain identifiers.
//
// Added for "Pets allowed", which applies to a rental and means nothing
// on a sale, a distinction property_type cannot express. Any future
// rent-only or sale-only spec uses the same slug.
export const CONDITION_DEPENDENCY_SLUG = '$condition';

// Generic "field depends on another field's value" mechanism, driven
// entirely by CategoryAttribute.dependsOnSlug/dependsOnValues (set in the
// DB, resolved in SettingsStore's dbToCategoryAttribute). An attribute
// with no dependency is always visible; one with a dependency is only
// visible once what it references currently holds one of the listed
// values -- either a sibling attribute by slug, or the listing's own
// condition via CONDITION_DEPENDENCY_SLUG above. Built for Properties'
// Property Type -> Bedrooms/Bathrooms/etc relationship, but deliberately
// category-agnostic so any future category can use it too.
//
// Filtering the shared specAttrs list through this once, at its source
// in CreateListingScreen.tsx and BatchDetailsScreen.tsx, is the single
// choke point: everything already downstream of specAttrs (spec-line
// building, the AI-suggestion schema, payload building, required-field
// validation, the review-step summary) automatically respects field
// visibility with no further changes.
//
// `condition` is optional so a caller with no listing-level condition to
// hand (a preview, a test) keeps working -- such a caller simply hides
// every condition-dependent attribute, which is the safe direction: a
// hidden attribute is never required and never saved.
export function resolveVisibleAttrs(
  attrs: CategoryAttribute[],
  attrValues: Record<string, AttributeValue>,
  condition?: Listing['condition']
): CategoryAttribute[] {
  return attrs.filter((a) => {
    if (!a.dependsOnSlug || !a.dependsOnValues) return true;
    const v =
      a.dependsOnSlug === CONDITION_DEPENDENCY_SLUG ? condition ?? undefined : attrValues[a.dependsOnSlug];
    return typeof v === 'string' && a.dependsOnValues.includes(v);
  });
}
