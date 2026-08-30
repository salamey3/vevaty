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
  return unit ? `${value} ${unit}` : String(value);
}
