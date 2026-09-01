import { AttributeValue, CategoryAttribute } from '../types';

// True if a listing actually has something meaningful saved for this
// attribute -- used both to validate "required" fields on the create
// form and to decide whether to show a spec on the listing detail page.
export function attrHasValue(v: AttributeValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  // A lone "-" is the half-typed state of a negative number field (see
  // CategorySpecsForm's onChangeNumber) -- a seller on their way to -1,
  // not an answer. Treating it as filled in would let a required field
  // pass validation and save "-" where a number belongs.
  if (typeof v === 'string') return v.trim().length > 0 && v.trim() !== '-';
  if (Array.isArray(v)) return v.length > 0;
  return true; // number/boolean
}

// Renders one attribute's value for display, in the given language --
// resolving select/multiselect option values to their labels and
// appending the attribute's unit where relevant.
export function formatAttrValue(attr: CategoryAttribute, value: AttributeValue | undefined, language: 'en' | 'ar'): string {
  if (value === undefined) return '';
  const unit = language === 'ar' ? attr.unitAr : attr.unitEn;
  if (attr.type === 'boolean') return value ? '✓' : '—';
  if (attr.type === 'select') {
    const opt = attr.options.find((o) => o.value === value);
    return opt ? (language === 'ar' ? opt.labelAr : opt.labelEn) : String(value);
  }
  if (attr.type === 'multiselect' && Array.isArray(value)) {
    return value
      .map((v) => {
        const opt = attr.options.find((o) => o.value === v);
        return opt ? (language === 'ar' ? opt.labelAr : opt.labelEn) : v;
      })
      .join(', ');
  }
  return unit ? `${groupDigits(value)} ${unit}` : String(value);
}

// Thousands separators, but ONLY on a value that carries a unit.
//
// The guard is what makes this safe. A mileage is "94,975 km" and unreadable
// without the commas -- it sits in bold beside a price that is grouped, so an
// ungrouped one reads as a different kind of number. A year is "2018" and
// must never become "2,018", and years, floor counts and bedroom counts are
// exactly the unitless numbers this leaves alone.
//
// Applies on the listing detail page too, which is the right outcome: the
// same figure should not be punctuated differently in two places.
//
// toLocaleString with NO locale argument, deliberately -- it matches what
// priceDisplay does for the price sitting inches away on the same card.
// Pinning 'en-US' here would have grouped the mileage by one rule and the
// price beside it by another on any non-English device, which is precisely
// the "reads as a different kind of number" problem this exists to fix.
function groupDigits(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  // 1000, matching priceDisplay exactly. A higher threshold would have
  // reintroduced the mismatch this exists to remove: a 5,000 sqm plot
  // rendering "5000 sqm" beside a price rendering "$5,000".
  if (!Number.isFinite(n) || Math.abs(n) < 1000) return String(value);
  return n.toLocaleString();
}
