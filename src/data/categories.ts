import { ConditionMode, Category, ListingDomain } from '../types';

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
  // What this category's listings use `condition` for -- see
  // Category.conditionMode. Offline fallback only, like everything else
  // here; the real value comes from Supabase.
  conditionMode: ConditionMode | null = null,
  // jobs and services are switched off in the database. Without this the
  // fallback renders two tiles that vanish the moment the real fetch
  // lands -- precisely the flash this file exists to prevent.
  active = true,
  // Which gate card this sits behind. Defaulted to classifieds because
  // that is where nine of the twelve live; the three that differ pass it.
  domainId: string | null = 'classifieds'
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
    conditionMode,
    domainId,
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

// Offline / first-paint fallback for the gate, same story as
// DEFAULT_CATEGORIES below. Mirrors myazar.listing_domains. Jobs &
// Services is listed but never renders while both of its categories are
// inactive -- the gate filters on "has at least one active category", so
// it needs no separate switch here.
export const DEFAULT_DOMAINS: ListingDomain[] = [
  { id: 'properties', nameEn: 'Properties', nameAr: 'عقارات', icon: 'building', sortOrder: 0, active: true },
  { id: 'vehicles', nameEn: 'Vehicles', nameAr: 'مركبات', icon: 'car', sortOrder: 1, active: true },
  { id: 'classifieds', nameEn: 'Classifieds', nameAr: 'إعلانات مبوبة', icon: 'grip', sortOrder: 2, active: true },
  { id: 'jobs-services', nameEn: 'Jobs & Services', nameAr: 'وظائف وخدمات', icon: 'briefcase', sortOrder: 3, active: true },
];

export const DEFAULT_CATEGORIES: Category[] = [
  topLevel('vehicles', 'Vehicles', 'مركبات', 'car', 0, false,
    ['Front 3/4 view', 'Rear 3/4 view', 'Interior / dashboard', 'Odometer reading', 'Any damage close-up'],
    ['منظر أمامي جانبي', 'منظر خلفي جانبي', 'الداخلية / لوحة القيادة', 'قراءة عداد المسافة', 'صورة مقرّبة لأي ضرر'],
    'offer_type', true, 'vehicles'),
  topLevel('auto-parts-accessories', 'Auto Parts & Accessories', 'قطع غيار وإكسسوارات', 'wrench', 1, false, [], [], null, true, 'vehicles'),
  topLevel('properties', 'Properties', 'عقارات', 'building', 2, false, [], [], 'offer_type', true, 'properties'),
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
  topLevel('jobs', 'Jobs', 'وظائف', 'briefcase', 11, false, [], [], null, false, 'jobs-services'),
  topLevel('fashion-beauty', 'Fashion & Beauty', 'أزياء وجمال', 'shirt', 12, false,
    ['Front, laid flat or worn', 'Back', 'Label / size tag', 'Any flaws close-up'],
    ['من الأمام، مفرودة أو ملبوسة', 'من الخلف', 'بطاقة الماركة / المقاس', 'صورة مقرّبة لأي عيوب']),
  topLevel('services', 'Services', 'خدمات', 'wrench', 13, true, [], [], null, false, 'jobs-services'),
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
