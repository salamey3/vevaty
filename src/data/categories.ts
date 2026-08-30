import { Category } from '../types';

// Offline / first-paint fallback only. The real, admin-editable category
// list is fetched from Supabase (myazar.categories) by SettingsStore --
// this array is what the app shows before that fetch completes, and what
// it falls back to if the device is offline. It intentionally mirrors the
// database's current top-level seed data (14 categories, transcribed from
// the reference marketplace's category picker) so there's no visible flash
// of different content on a normal, online launch. Subcategories are never
// included here -- as before, they only ever come from Supabase once
// loaded, both in the old 6-category tree and this one.
function topLevel(
  id: string,
  nameEn: string,
  nameAr: string,
  icon: string,
  sortOrder: number,
  isService: boolean,
  shotListEn: string[] = [],
  shotListAr: string[] = [],
  // Whether this category's listings use `condition` for Sale/Rent/Both
  // rather than New/Used -- see Category.usesOfferType. Offline fallback
  // only, like everything else here; the real value comes from Supabase.
  usesOfferType = false,
  // jobs and services are switched off in the database. Without this the
  // fallback renders two tiles that vanish the moment the real fetch
  // lands -- precisely the flash this file exists to prevent.
  active = true
): Category {
  return {
    id,
    parentId: null,
    nameEn,
    nameAr,
    iconUrl: null,
    icon,
    supports3d: false,
    shotListEn,
    shotListAr,
    // Offline/first-paint fallback only (see file header) -- always
    // empty here since this builder only ever seeds top-level categories,
    // and the 15 leaf categories with real verification shots always come
    // from Supabase once loaded.
    verificationShotListEn: [],
    verificationShotListAr: [],
    sortOrder,
    active,
    isService,
    usesOfferType,
    titleExampleEn: null,
    titleExampleAr: null,
    descriptionExampleEn: null,
    descriptionExampleAr: null,
    areaFilterPriority: null,
    subcategoryFilterPriority: 1,
    // Offline/first-paint fallback only (see the file header comment) --
    // the real value always comes from Supabase once loaded, so 'unique'
    // here just matches every category's default until that fetch lands.
    stockMode: 'unique',
  };
}

export const DEFAULT_CATEGORIES: Category[] = [
  topLevel('vehicles', 'Vehicles', 'مركبات', 'car', 0, false,
    ['Front 3/4 view', 'Rear 3/4 view', 'Interior / dashboard', 'Odometer reading', 'Any damage close-up'],
    ['منظر أمامي جانبي', 'منظر خلفي جانبي', 'الداخلية / لوحة القيادة', 'قراءة عداد المسافة', 'صورة مقرّبة لأي ضرر'],
    true),
  topLevel('auto-parts-accessories', 'Auto Parts & Accessories', 'قطع غيار وإكسسوارات', 'wrench', 1, false),
  topLevel('properties', 'Properties', 'عقارات', 'building', 2, false, [], [], true),
  topLevel('mobiles-accessories', 'Mobiles & Accessories', 'موبايلات وإكسسوارات', 'phone', 3, false,
    ['Front, screen on', 'Back panel', 'All sides', 'Any scratches or damage', 'Box / accessories (if any)'],
    ['الأمام، والشاشة مضاءة', 'اللوحة الخلفية', 'كل الجوانب', 'أي خدوش أو تلف', 'العلبة / الملحقات (إن وجدت)']),
  topLevel('electronics-appliances', 'Electronics & Appliances', 'إلكترونيات وأجهزة منزلية', 'tv', 4, false,
    ['Front, screen on', 'Back panel', 'All sides', 'Any scratches or damage', 'Box / accessories (if any)'],
    ['الأمام، والشاشة مضاءة', 'اللوحة الخلفية', 'كل الجوانب', 'أي خدوش أو تلف', 'العلبة / الملحقات (إن وجدت)']),
  topLevel('furniture-decor', 'Furniture & Decor', 'أثاث وديكور', 'sofa', 5, false,
    ['Full item, straight on', 'Close-up of material / fabric', 'Any wear or damage', 'Dimensions shot (tape measure)'],
    ['القطعة كاملة من الأمام', 'صورة مقرّبة للخامة / القماش', 'أي تآكل أو تلف', 'صورة القياسات (بشريط القياس)']),
  topLevel('businesses-industrial', 'Businesses & Industrial', 'أعمال وصناعة', 'factory', 6, false),
  topLevel('pets', 'Pets', 'حيوانات أليفة', 'paw', 7, false),
  topLevel('kids-babies', 'Kids & Babies', 'أطفال ورضّع', 'baby', 8, false),
  topLevel('sports-equipment', 'Sports & Equipment', 'رياضة ومعدات', 'dumbbell', 9, false),
  topLevel('hobbies', 'Hobbies', 'هوايات', 'sparkle', 10, false),
  topLevel('jobs', 'Jobs', 'وظائف', 'briefcase', 11, false, [], [], false, false),
  topLevel('fashion-beauty', 'Fashion & Beauty', 'أزياء وجمال', 'shirt', 12, false,
    ['Front, laid flat or worn', 'Back', 'Label / size tag', 'Any flaws close-up'],
    ['من الأمام، مفرودة أو ملبوسة', 'من الخلف', 'بطاقة الماركة / المقاس', 'صورة مقرّبة لأي عيوب']),
  topLevel('services', 'Services', 'خدمات', 'wrench', 13, true, [], [], false, false),
];

// Built-in icon fallback for categories that don't have a custom uploaded
// icon_url yet. Anything not in this map (i.e. any new admin-created
// category before it has its own icon) falls back to a generic mark.
export const BUILTIN_ICON_FALLBACK: Record<string, string> = {
  vehicles: 'car',
  'auto-parts-accessories': 'wrench',
  properties: 'building',
  'mobiles-accessories': 'phone',
  'electronics-appliances': 'tv',
  'furniture-decor': 'sofa',
  'businesses-industrial': 'factory',
  pets: 'paw',
  'kids-babies': 'baby',
  'sports-equipment': 'dumbbell',
  hobbies: 'sparkle',
  jobs: 'briefcase',
  'fashion-beauty': 'shirt',
  services: 'wrench',
};
export const GENERIC_CATEGORY_ICON = 'sparkle';

// Brand defaults -- see BRANDING.md part 3. These feed applyBrandColors(),
// which writes --vevaty-primary / --vevaty-accent on <html>, so they
// override the fallbacks baked into theme.ts. Leaving the old charcoal
// here silently repainted the whole app charcoal no matter what theme.ts
// said, which is exactly what happened the first time this shipped.
export const DEFAULT_SITE_SETTINGS = {
  brandPrimaryColor: '#0F3D2E',
  brandAccentColor: '#D9A441',
  logoEnUrl: null as string | null,
  logoArUrl: null as string | null,
  faviconUrl: null as string | null,
};
