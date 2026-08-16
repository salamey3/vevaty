import { Category } from '../types';

// Offline / first-paint fallback only. The real, admin-editable category
// list is fetched from Supabase (myazar.categories) by SettingsStore --
// this array is what the app shows before that fetch completes, and what
// it falls back to if the device is offline. It intentionally mirrors the
// database's current top-level seed data (13 categories, transcribed from
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
  shotListAr: string[] = []
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
    sortOrder,
    active: true,
    isService,
    titleExampleEn: null,
    titleExampleAr: null,
    descriptionExampleEn: null,
    descriptionExampleAr: null,
    areaFilterPriority: null,
    subcategoryFilterPriority: 1,
  };
}

export const DEFAULT_CATEGORIES: Category[] = [
  topLevel('vehicles', 'Vehicles', 'مركبات', 'car', 0, false,
    ['Front 3/4 view', 'Rear 3/4 view', 'Interior / dashboard', 'Odometer reading', 'Any damage close-up'],
    ['منظر أمامي جانبي', 'منظر خلفي جانبي', 'الداخلية / لوحة القيادة', 'قراءة عداد المسافة', 'صورة مقرّبة لأي ضرر']),
  topLevel('properties', 'Properties', 'عقارات', 'building', 1, false),
  topLevel('mobiles-accessories', 'Mobiles & Accessories', 'موبايلات وإكسسوارات', 'phone', 2, false,
    ['Front, screen on', 'Back panel', 'All sides', 'Any scratches or damage', 'Box / accessories (if any)'],
    ['الأمام، والشاشة مضاءة', 'اللوحة الخلفية', 'كل الجوانب', 'أي خدوش أو تلف', 'العلبة / الملحقات (إن وجدت)']),
  topLevel('electronics-appliances', 'Electronics & Appliances', 'إلكترونيات وأجهزة منزلية', 'tv', 3, false,
    ['Front, screen on', 'Back panel', 'All sides', 'Any scratches or damage', 'Box / accessories (if any)'],
    ['الأمام، والشاشة مضاءة', 'اللوحة الخلفية', 'كل الجوانب', 'أي خدوش أو تلف', 'العلبة / الملحقات (إن وجدت)']),
  topLevel('furniture-decor', 'Furniture & Decor', 'أثاث وديكور', 'sofa', 4, false,
    ['Full item, straight on', 'Close-up of material / fabric', 'Any wear or damage', 'Dimensions shot (tape measure)'],
    ['القطعة كاملة من الأمام', 'صورة مقرّبة للخامة / القماش', 'أي تآكل أو تلف', 'صورة القياسات (بشريط القياس)']),
  topLevel('businesses-industrial', 'Businesses & Industrial', 'أعمال وصناعة', 'factory', 5, false),
  topLevel('pets', 'Pets', 'حيوانات أليفة', 'paw', 6, false),
  topLevel('kids-babies', 'Kids & Babies', 'أطفال ورضّع', 'baby', 7, false),
  topLevel('sports-equipment', 'Sports & Equipment', 'رياضة ومعدات', 'dumbbell', 8, false),
  topLevel('hobbies', 'Hobbies', 'هوايات', 'sparkle', 9, false),
  topLevel('jobs', 'Jobs', 'وظائف', 'briefcase', 10, false),
  topLevel('fashion-beauty', 'Fashion & Beauty', 'أزياء وجمال', 'shirt', 11, false,
    ['Front, laid flat or worn', 'Back', 'Label / size tag', 'Any flaws close-up'],
    ['من الأمام، مفرودة أو ملبوسة', 'من الخلف', 'بطاقة الماركة / المقاس', 'صورة مقرّبة لأي عيوب']),
  topLevel('services', 'Services', 'خدمات', 'wrench', 12, true),
];

// Built-in icon fallback for categories that don't have a custom uploaded
// icon_url yet. Anything not in this map (i.e. any new admin-created
// category before it has its own icon) falls back to a generic mark.
export const BUILTIN_ICON_FALLBACK: Record<string, string> = {
  vehicles: 'car',
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

export const DEFAULT_SITE_SETTINGS = {
  brandPrimaryColor: '#2b2b2f',
  brandAccentColor: '#4c4d52',
  logoEnUrl: null as string | null,
  logoArUrl: null as string | null,
  faviconUrl: null as string | null,
};
