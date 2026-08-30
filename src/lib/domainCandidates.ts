import { Category, ListingDomain } from '../types';
import { ClassifyCategoryOption, domainSentinelId } from './classifyPhotos';

// Builds the closed list the classifier chooses from, given the domain the
// seller picked on the sell gate. Two jobs in one place so the single-item
// wizard and the batch review screen can never drift on either.
//
// The constraint. Only leaves inside the chosen domain are offered, which
// is what makes a cross-domain answer structurally impossible rather than
// merely unlikely: the edge function validates its own answer against the
// list it was handed, so a category that is not here cannot come back. No
// change to the function itself -- it has always taken the candidates from
// the caller.
//
// The escape. One sentinel per *other* domain is appended, described in
// plain terms rather than by name, so the model has somewhere honest to
// put photos that plainly belong elsewhere. Picking one is the mismatch
// signal that raises the "switch to Properties?" offer. Without them a
// seller who tapped the wrong card would get the least-bad wrong answer
// from within their domain and no indication anything was off -- the trap
// the hard constraint was explicitly not meant to become.
export function buildDomainCandidates(
  domainId: string | null,
  leafCategories: Category[],
  allDomains: ListingDomain[],
  categoryById: (id: string) => Category | undefined,
  domainOfCategory: (categoryId: string) => ListingDomain | undefined,
  language: 'en' | 'ar'
): ClassifyCategoryOption[] {
  const named = (c: Category) => (language === 'ar' ? c.nameAr : c.nameEn);

  const inDomain = domainId
    ? leafCategories.filter((c) => domainOfCategory(c.id)?.id === domainId)
    : leafCategories;

  const options: ClassifyCategoryOption[] = inDomain.map((c) => {
    const parent = c.parentId ? categoryById(c.parentId) : undefined;
    return { id: c.id, name: named(c), parent: parent ? named(parent) : undefined };
  });

  // Unconstrained (a batch started before the gate existed, say) means
  // there is no "elsewhere" to point at.
  if (!domainId) return options;

  for (const d of allDomains) {
    if (d.id === domainId) continue;
    // Skip a domain the seller could not switch to anyway.
    if (!leafCategories.some((c) => domainOfCategory(c.id)?.id === d.id)) continue;
    options.push({
      id: domainSentinelId(d.id),
      name: sentinelDescription(d, language),
    });
  }
  return options;
}

// Described by what is in it rather than by its name: "Properties" tells a
// vision model nothing, while "a property -- apartment, villa, land" tells
// it exactly what it is being asked to recognise. These read as ordinary
// entries in the candidate list, which is the point.
function sentinelDescription(domain: ListingDomain, language: 'en' | 'ar'): string {
  const ar = language === 'ar';
  switch (domain.id) {
    case 'properties':
      return ar
        ? 'عقار — شقة أو فيلا أو شاليه أو أرض أو محل تجاري (ليس غرضًا منقولًا)'
        : 'A property — an apartment, villa, chalet, land or commercial space (not a movable item)';
    case 'vehicles':
      return ar
        ? 'مركبة — سيارة أو دراجة نارية أو شاحنة أو قارب، أو قطع غيار'
        : 'A vehicle — a car, motorcycle, truck or boat, or vehicle parts';
    case 'classifieds':
      return ar
        ? 'غرض عام — هاتف أو أثاث أو ملابس أو جهاز منزلي أو ما شابه'
        : 'A general item — a phone, furniture, clothing, appliance or similar';
    default:
      return ar ? domain.nameAr : domain.nameEn;
  }
}
