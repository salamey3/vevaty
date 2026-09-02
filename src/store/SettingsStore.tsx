import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureSession } from '../lib/supabase';
import { applyBrandColors } from '../theme/theme';
import { applyFavicon } from '../lib/favicon';
import { AttributeOption, AttributeType, Category, CategoryAttribute, ConditionMode, FilterFacet, ListingDomain, SiteSettings } from '../types';
import { ICON_NAMES, type IconName } from '../icons/Icon';
import {
  DEFAULT_CATEGORIES, DEFAULT_DOMAINS, DEFAULT_SITE_SETTINGS, BUILTIN_ICON_FALLBACK,
  GENERIC_CATEGORY_ICON, DEFAULT_LISTING_LIFETIME_DAYS,
} from '../data/categories';

const KEYS = {
  categories: 'vevaty:categories',
  listingDomains: 'vevaty:listingDomains',
  categoryAttributes: 'vevaty:categoryAttributes',
  siteSettings: 'vevaty:siteSettings',
  adminLockDuration: 'vevaty:admin:lockDurationMinutes',
  adminBiometricCredId: 'vevaty:admin:biometricCredentialId',
};

const DEFAULT_ADMIN_LOCK_MINUTES = 30;

// Local-only WebAuthn helpers -- this app never sends the credential to a
// server for verification (see AdminGateScreen/SettingsStore comments on
// adminSignIn): the platform biometric prompt is purely a device-level
// gate that re-opens an already fully-verified (password+TOTP), still-live
// session after the auto-lock timer fires. That means we only ever need
// the credential ID locally, never its public key -- these two functions
// A category list read back from the device cache, which was written by
// whatever build was installed at the time. Every other cached entity in
// this app goes through a normalizer for this reason (see AppStore's
// normalizeListing); the categories cache never had one, and renaming a
// field is exactly when that bites.
//
// The rename in question: `uses_offer_type` (boolean) became
// `condition_mode`. Without this, a device upgrading with a warm cache
// reads its Properties row as having no mode at all, and until the network
// fetch lands -- forever, offline -- a seller posting an apartment is
// asked New or Used and given no rent terms.
function normalizeCachedCategories(raw: any): Category[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any) => ({
    ...c,
    conditionMode:
      (c?.conditionMode as ConditionMode) ?? (c?.usesOfferType ? 'offer_type' : null),
    listingLifetimeDays: typeof c?.listingLifetimeDays === 'number' ? c.listingLifetimeDays : null,
  })) as Category[];
}

// just convert it to/from a string AsyncStorage can hold.
function bufferToBase64Url(buf: ArrayBuffer): string {
  let str = '';
  new Uint8Array(buf).forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + (4 - (b64url.length % 4)) % 4, '=');
  const str = atob(b64);
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf.buffer;
}

interface CreateCategoryInput {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  iconUrl?: string | null;
  supports3d: boolean;
  shotListEn: string[];
  shotListAr: string[];
  isService: boolean;
  conditionMode: ConditionMode | null;
  listingLifetimeDays: number | null;
  cardKindSlug: string | null;
  cardConditionSlug: string | null;
  domainId: string | null;
  titleExampleEn: string | null;
  titleExampleAr: string | null;
  descriptionExampleEn: string | null;
  descriptionExampleAr: string | null;
  stockMode: 'unique' | 'multiple';
}

interface UpdateCategoryPatch {
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  iconUrl: string | null;
  supports3d: boolean;
  shotListEn: string[];
  shotListAr: string[];
  active: boolean;
  isService: boolean;
  conditionMode: ConditionMode | null;
  listingLifetimeDays: number | null;
  cardKindSlug: string | null;
  cardConditionSlug: string | null;
  domainId: string | null;
  titleExampleEn: string | null;
  titleExampleAr: string | null;
  descriptionExampleEn: string | null;
  descriptionExampleAr: string | null;
  stockMode: 'unique' | 'multiple';
}

interface CreateAttributeInput {
  categoryId: string;
  slug: string;
  labelEn: string;
  labelAr: string;
  type: AttributeType;
  options: AttributeOption[];
  unitEn: string | null;
  unitAr: string | null;
  required: boolean;
  isVariant: boolean;
  // Which slot this takes on a listing card (1 = first), or null for "not
  // on the card". See src/lib/cardSpecs.ts.
  cardPriority: number | null;
  // Glyph beside the value on a card. Null renders a short text label
  // instead, which is the right answer for a self-describing value.
  icon: IconName | null;
}

interface UpdateAttributePatch {
  labelEn: string;
  labelAr: string;
  type: AttributeType;
  options: AttributeOption[];
  unitEn: string | null;
  unitAr: string | null;
  required: boolean;
  isVariant: boolean;
  // Which slot this takes on a listing card (1 = first), or null for "not
  // on the card". See src/lib/cardSpecs.ts.
  cardPriority: number | null;
  // Glyph beside the value on a card. Null renders a short text label
  // instead, which is the right answer for a self-describing value.
  icon: IconName | null;
}

interface SettingsValue {
  ready: boolean;
  // Active, TOP-LEVEL categories only, sorted -- what the home/browse/
  // create-listing top-level pickers should show. Drill into a
  // category's subcategories with childrenOf(id).
  categories: Category[];
  // Every category including inactive ones and subcategories, flat --
  // what the admin categories manager builds its tree from.
  allCategories: Category[];
  categoryById: (id: string) => Category | undefined;
  // Active (or, with includeInactive, all) direct children of a
  // category -- null means "top-level categories".
  childrenOf: (parentId: string | null, opts?: { includeInactive?: boolean }) => Category[];
  // A category's ancestors, root-first, not including itself -- e.g.
  // ancestorsOf('properties-apartments-villas-for-sale') -> [Properties].
  ancestorsOf: (id: string) => Category[];
  // True if `listingCategoryId` is `filterCategoryId` itself, or a
  // descendant of it -- used so a "Properties" filter also matches
  // listings posted directly under "Apartments".
  categoryMatches: (listingCategoryId: string, filterCategoryId: string) => boolean;
  // True if the category (or any ancestor) is flagged as a services
  // category -- drives the "Contact to hire" call-to-action.
  isServiceCategory: (categoryId: string) => boolean;
  // What `condition` means for this category, walking up the tree: the
  // nearest ancestor (itself included) that names something other than
  // the default wins.
  conditionModeForCategory: (categoryId: string) => ConditionMode;
  // Slug of the attribute whose value labels a listing card here, or null
  // to use the category's own name. Inherited nearest-ancestor-first --
  // see Category.cardKindSlug for why the two collapsed categories need it.
  cardKindSlugForCategory: (categoryId: string) => string | null;
  // Which attribute supplies the card's condition badge here -- see
  // Category.cardConditionSlug for why two categories need one at all.
  cardConditionSlugForCategory: (categoryId: string) => string | null;
  // Days a listing in this category lives before expiring. Display only
  // -- the database decides the real expiry. See LIFECYCLE.md.
  lifetimeDaysForCategory: (categoryId: string) => number;
  // conditionModeForCategory(id) === 'offer_type', kept as its own name
  // because the rent-terms code reads better asking that question.
  usesOfferTypeCategory: (categoryId: string) => boolean;
  // Active domains that have at least one active category, in order --
  // what the gate renders. Jobs & Services is filtered out here until its
  // categories are switched on.
  domains: ListingDomain[];
  // Every domain including ones with nothing active in them -- the admin
  // category editor needs to offer Jobs & Services even while it is
  // dormant. Same relationship as categories/allCategories.
  allDomains: ListingDomain[];
  domainById: (id: string) => ListingDomain | undefined;
  // The domain a category belongs to, found by walking up to its
  // top-level ancestor. Categories carry domain_id only on that top-level
  // row, so reading it off a leaf directly returns null.
  domainOfCategory: (categoryId: string) => ListingDomain | undefined;
  // Active top-level categories within a domain, in order. One for
  // Properties, two for Vehicles, nine for Classifieds.
  categoriesInDomain: (domainId: string) => Category[];
  // Every attribute row for every category. Prefer resolveAttributesForCategory
  // for rendering a listing form; this is mainly for the admin attribute manager.
  categoryAttributes: CategoryAttribute[];
  // The effective, ordered spec schema for a category -- its own
  // attributes plus everything inherited from its ancestors (root-first,
  // with a subcategory's own definition winning if a slug collides).
  resolveAttributesForCategory: (categoryId: string) => CategoryAttribute[];
  // The Home-screen filter drill-down sequence for a category: its own
  // "pick a subcategory" / "Area" steps (if configured) plus its own
  // filterable attributes, concatenated root-first with whatever the
  // same facets were already configured on its ancestors -- so once a
  // subcategory is chosen mid-drill-down, its own additional filters
  // (e.g. storage_gb on Phones) are appended after whatever the parent
  // category (Electronics) still has left to ask.
  resolveFilterFacetsForCategory: (categoryId: string) => FilterFacet[];
  siteSettings: SiteSettings;
  isAdmin: boolean;
  adminChecked: boolean;
  refreshIsAdmin: () => Promise<boolean>;
  createCategory: (input: CreateCategoryInput) => Promise<void>;
  updateCategory: (id: string, patch: Partial<UpdateCategoryPatch>) => Promise<void>;
  // `parentId` scopes the reorder to that group of siblings (null = top level).
  reorderCategories: (parentId: string | null, orderedIds: string[]) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  createAttribute: (input: CreateAttributeInput) => Promise<void>;
  updateAttribute: (id: string, patch: Partial<UpdateAttributePatch>) => Promise<void>;
  deleteAttribute: (id: string) => Promise<void>;
  reorderAttributes: (categoryId: string, orderedIds: string[]) => Promise<void>;
  // Persists this category's OWN filter drill-down order (and which
  // facets are included at all) in one shot. `orderedFacetKeys` is a
  // subset of ['subcategory', 'area', ...own attribute slugs] in the
  // desired order; anything from this category's own facets that isn't
  // listed gets its priority cleared (removed from the filter sequence,
  // still usable as a spec/create-form field as before).
  setFilterPriorities: (categoryId: string, orderedFacetKeys: string[]) => Promise<void>;
  updateSiteSettings: (patch: Partial<SiteSettings>) => Promise<void>;
  // Password alone (aal1) is no longer enough -- both of these stop short
  // of setting isAdmin true and instead report whether this account still
  // needs to enroll a TOTP factor for the first time, or just needs to
  // clear a challenge against its existing one. adminMfaVerify (below)
  // is the only thing that actually flips isAdmin on.
  adminSignIn: (email: string, password: string) => Promise<{ error?: string; status?: 'needsEnroll' | 'needsChallenge'; factorId?: string }>;
  adminBootstrapSignUp: (email: string, password: string) => Promise<{ error?: string; status?: 'needsEnroll' }>;
  adminEnrollMfaStart: () => Promise<{ error?: string; factorId?: string; qrCode?: string; secret?: string }>;
  adminMfaVerify: (factorId: string, code: string) => Promise<{ error?: string }>;
  // Only needed by the lock screen's fallback path -- unlocking after the
  // auto-lock timer fires happens without a fresh adminSignIn call, so
  // there's no factorId already in hand.
  getVerifiedTotpFactorId: () => Promise<string | null>;
  adminSignOut: () => Promise<void>;
  // Auto-lock: a purely client-side UI gate on top of an already-live
  // Supabase session -- locking never signs out or touches aal. Resets on
  // any recordActivity() call; the idle timer only runs while isAdmin.
  sessionLocked: boolean;
  lockDurationMinutes: number;
  setLockDuration: (minutes: number) => void;
  recordActivity: () => void;
  // Local-only biometric unlock (see bufferToBase64Url's comment above) --
  // never a substitute for TOTP on a fresh login, only for re-entering an
  // already-verified session after it auto-locks.
  biometricSupported: boolean;
  hasBiometricCredential: boolean;
  registerBiometricCredential: () => Promise<{ error?: string }>;
  tryBiometricUnlock: () => Promise<{ error?: string }>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function dbToCategory(row: any): Category {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    iconUrl: row.icon_url || null,
    icon: BUILTIN_ICON_FALLBACK[row.id] || GENERIC_CATEGORY_ICON,
    supports3d: !!row.supports_3d,
    shotListEn: Array.isArray(row.required_shot_list) ? row.required_shot_list : [],
    shotListAr: Array.isArray(row.required_shot_list_ar) ? row.required_shot_list_ar : [],
    verificationShotListEn: Array.isArray(row.verification_shot_list_en) ? row.verification_shot_list_en : [],
    verificationShotListAr: Array.isArray(row.verification_shot_list_ar) ? row.verification_shot_list_ar : [],
    sortOrder: row.sort_order ?? 0,
    active: row.active !== false,
    isService: !!row.is_service,
    conditionMode: (row.condition_mode as ConditionMode) ?? null,
    cardKindSlug: row.card_kind_slug || null,
    cardConditionSlug: row.card_condition_slug || null,
    listingLifetimeDays: typeof row.listing_lifetime_days === 'number' ? row.listing_lifetime_days : null,
    domainId: row.domain_id || null,
    titleExampleEn: row.title_example_en || null,
    titleExampleAr: row.title_example_ar || null,
    descriptionExampleEn: row.description_example_en || null,
    descriptionExampleAr: row.description_example_ar || null,
    areaFilterPriority: row.area_filter_priority ?? null,
    subcategoryFilterPriority: row.subcategory_filter_priority ?? null,
    stockMode: row.stock_mode === 'multiple' ? 'multiple' : 'unique',
  };
}

function dbToListingDomain(row: any): ListingDomain {
  return {
    id: row.id,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    icon: row.icon || 'grip',
    sortOrder: row.sort_order ?? 0,
    active: row.active !== false,
  };
}

// The database column is a plain text field on purpose (a CHECK listing
// every glyph would have to be migrated in lockstep with the TypeScript
// union), so the validation happens here instead: an icon name the app does
// not have becomes null, which the card already knows how to render as a
// text label. A typo in the admin therefore looks plain, never broken, and
// never crashes Icon with a name it cannot draw.
const KNOWN_ICON_NAMES = new Set<string>(ICON_NAMES);

// Per-row write counters, the same shape as AppStore's updateListingSeq and
// for the same reason. Capture-inside-the-updater and restore-one-row are not
// enough on their own once two writes can overlap on one row: an older write
// that fails after a newer one has succeeded would otherwise roll back OVER
// the newer value. AdminCategoriesScreen's 700ms debounced autosave makes
// that overlap ordinary rather than theoretical -- typing, pausing, and
// typing again starts a second write while the first is still in the air.
//
// Module scope, not a ref, so the counter survives a remount of the provider
// mid-write.
const updateCategorySeq = new Map<string, number>();
const updateAttributeSeq = new Map<string, number>();

function dbToCategoryAttribute(row: any): CategoryAttribute {
  return {
    id: row.id,
    categoryId: row.category_id,
    slug: row.slug,
    labelEn: row.label_en,
    labelAr: row.label_ar,
    type: row.type,
    options: Array.isArray(row.options)
      ? row.options.map((o: any) => ({ value: String(o.value), labelEn: o.labelEn, labelAr: o.labelAr }))
      : [],
    unitEn: row.unit_en || null,
    unitAr: row.unit_ar || null,
    required: !!row.required,
    sortOrder: row.sort_order ?? 0,
    filterPriority: row.filter_priority ?? null,
    bound: row.bound === 'min' || row.bound === 'max' ? row.bound : null,
    cardPriority: row.card_priority ?? null,
    icon: typeof row.icon === 'string' && KNOWN_ICON_NAMES.has(row.icon) ? (row.icon as IconName) : null,
    isVariant: !!row.is_variant,
    dependsOnSlug: row.depends_on_slug || null,
    dependsOnValues: Array.isArray(row.depends_on_values) ? row.depends_on_values : null,
    allowNegative: !!row.allow_negative,
  };
}

function dbToSiteSettings(row: any): SiteSettings {
  return {
    brandPrimaryColor: row.brand_primary_color || DEFAULT_SITE_SETTINGS.brandPrimaryColor,
    brandAccentColor: row.brand_accent_color || DEFAULT_SITE_SETTINGS.brandAccentColor,
    logoEnUrl: row.logo_en_url || null,
    logoArUrl: row.logo_ar_url || null,
    faviconUrl: row.favicon_url || null,
  };
}

function friendlyError(e: any, context: 'category' | 'attribute' = 'category'): string {
  const msg = e?.message || String(e);
  if (/one_variant_per_category/i.test(msg)) {
    return 'This category already has a different "is variant" attribute -- turn that one off first.';
  }
  if (/variant_type_check/i.test(msg)) {
    return 'Only a "Select (many)" field can be used as the variant attribute.';
  }
  if (/duplicate key|already exists/i.test(msg)) {
    return context === 'attribute'
      ? 'That attribute ID is already used on this category.'
      : 'That ID is already used by another category.';
  }
  if (/row-level security|permission denied/i.test(msg)) return 'Not allowed -- an admin account already exists, or you are not signed in as admin.';
  return msg;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [allCategories, setAllCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [allDomains, setAllDomains] = useState<ListingDomain[]>(DEFAULT_DOMAINS);
  const [allCategoryAttributes, setAllCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [lockDurationMinutes, setLockDurationMinutesState] = useState(DEFAULT_ADMIN_LOCK_MINUTES);
  const [hasBiometricCredential, setHasBiometricCredential] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const biometricSupported =
    typeof window !== 'undefined' && typeof (window as any).PublicKeyCredential !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.credentials;
  const loadedOnce = useRef(false);

  const applySiteSettings = useCallback((s: SiteSettings) => {
    setSiteSettings(s);
    applyBrandColors(s.brandPrimaryColor, s.brandAccentColor);
    applyFavicon(s.faviconUrl);
  }, []);

  const checkIsAdmin = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) {
        setIsAdmin(false);
        setAdminChecked(true);
        return false;
      }
      const { data: row } = await supabase.from('admins').select('user_id').maybeSingle();
      if (!row) {
        setIsAdmin(false);
        setAdminChecked(true);
        return false;
      }
      // Admins-table membership alone isn't enough -- the session must
      // also have actually cleared a TOTP challenge (aal2), not just
      // carry an aal1 password-only login. This is what makes MFA
      // required on every fresh login rather than just at enrollment
      // time, and it's re-checked here (not just in adminSignIn) so a
      // stale pre-MFA session -- e.g. one persisted from before this
      // feature shipped -- can't silently keep admin access on reload.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const admin = aal?.currentLevel === 'aal2';
      setIsAdmin(admin);
      setAdminChecked(true);
      return admin;
    } catch (e) {
      setAdminChecked(true);
      return false;
    }
  }, []);

  // 1) Load cached categories/attributes/settings from device storage
  // immediately.
  useEffect(() => {
    (async () => {
      try {
        const [rawCats, rawDomains, rawAttrs, rawSettings] = await Promise.all([
          AsyncStorage.getItem(KEYS.categories),
          AsyncStorage.getItem(KEYS.listingDomains),
          AsyncStorage.getItem(KEYS.categoryAttributes),
          AsyncStorage.getItem(KEYS.siteSettings),
        ]);
        if (rawCats) setAllCategories(normalizeCachedCategories(JSON.parse(rawCats)));
        if (rawDomains) setAllDomains(JSON.parse(rawDomains));
        if (rawAttrs) setAllCategoryAttributes(JSON.parse(rawAttrs));
        if (rawSettings) applySiteSettings(JSON.parse(rawSettings));
        else applySiteSettings(DEFAULT_SITE_SETTINGS);
      } catch (e) {
        // Fall back to the bundled defaults already in state.
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Device-local admin security preferences -- the chosen auto-lock
  // duration and whether a biometric credential was registered on this
  // device. Neither of these lives in Supabase; they're per-browser, not
  // per-account (see the bufferToBase64Url comment above for why).
  useEffect(() => {
    (async () => {
      try {
        const [rawDuration, credId] = await Promise.all([
          AsyncStorage.getItem(KEYS.adminLockDuration),
          AsyncStorage.getItem(KEYS.adminBiometricCredId),
        ]);
        if (rawDuration) setLockDurationMinutesState(Number(rawDuration) || DEFAULT_ADMIN_LOCK_MINUTES);
        setHasBiometricCredential(!!credId);
      } catch (e) {
        // Fall back to the defaults already in state.
      }
    })();
  }, []);

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const setLockDuration = useCallback((minutes: number) => {
    setLockDurationMinutesState(minutes);
    recordActivity();
    AsyncStorage.setItem(KEYS.adminLockDuration, String(minutes)).catch(() => {});
  }, [recordActivity]);

  // Idle-reset auto-lock: only ticks while signed in as admin, checks
  // every 15s whether it's been `lockDurationMinutes` since the last
  // recordActivity() call, and if so just flips `sessionLocked` -- it
  // never signs out or touches the underlying (still aal2) session. See
  // AdminLockScreen for what renders while this is true.
  useEffect(() => {
    if (!isAdmin) return;
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= lockDurationMinutes * 60 * 1000) setSessionLocked(true);
    }, 15000);
    return () => clearInterval(id);
  }, [isAdmin, lockDurationMinutes]);

  // 2) In the background, fetch the live categories + attribute schemas +
  // branding from Supabase and check whether the current session belongs
  // to an admin.
  const refreshFromSupabase = useCallback(async () => {
    try {
      await ensureSession();
      const [{ data: catRows, error: catErr }, { data: domainRows, error: domainErr }, { data: attrRows, error: attrErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order', { ascending: true }),
        supabase.from('listing_domains').select('*').order('sort_order', { ascending: true }),
        supabase.from('category_attributes').select('*').order('sort_order', { ascending: true }),
        supabase.from('site_settings').select('*').eq('id', true).maybeSingle(),
      ]);
      if (!catErr && catRows) {
        const mapped = catRows.map(dbToCategory);
        setAllCategories(mapped);
        AsyncStorage.setItem(KEYS.categories, JSON.stringify(mapped)).catch(() => {});
      }
      if (!domainErr && domainRows) {
        const mapped = domainRows.map(dbToListingDomain);
        setAllDomains(mapped);
        AsyncStorage.setItem(KEYS.listingDomains, JSON.stringify(mapped)).catch(() => {});
      }
      if (!attrErr && attrRows) {
        const mapped = attrRows.map(dbToCategoryAttribute);
        setAllCategoryAttributes(mapped);
        AsyncStorage.setItem(KEYS.categoryAttributes, JSON.stringify(mapped)).catch(() => {});
      }
      if (!settingsErr && settingsRow) {
        const mapped = dbToSiteSettings(settingsRow);
        applySiteSettings(mapped);
        AsyncStorage.setItem(KEYS.siteSettings, JSON.stringify(mapped)).catch(() => {});
      }
    } catch (e) {
      // Offline or backend unreachable -- keep using cached/default data.
    }
    await checkIsAdmin();
  }, [applySiteSettings, checkIsAdmin]);

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    refreshFromSupabase();
  }, [refreshFromSupabase]);

  // Re-check admin status (and re-pull data, since RLS visibility can
  // depend on who's signed in) whenever the Supabase auth session changes
  // -- e.g. signing in/out of the admin panel.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshFromSupabase();
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshFromSupabase]);

  const categories = useMemo(
    () =>
      allCategories
        .filter((c) => c.active && !c.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [allCategories]
  );
  const sortedAll = useMemo(() => [...allCategories].sort((a, b) => a.sortOrder - b.sortOrder), [allCategories]);

  const categoryById = useCallback((id: string) => allCategories.find((c) => c.id === id), [allCategories]);

  const childrenOf = useCallback(
    (parentId: string | null, opts?: { includeInactive?: boolean }) =>
      allCategories
        .filter((c) => (c.parentId || null) === parentId && (opts?.includeInactive || c.active))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [allCategories]
  );

  // Root-first chain of category ids leading to (and including) `id`.
  // Guards against a cycle ever short-circuiting into an infinite loop.
  const buildAncestorChain = useCallback(
    (id: string): string[] => {
      const chain: string[] = [];
      const visited = new Set<string>();
      let current: string | null | undefined = id;
      while (current && !visited.has(current)) {
        visited.add(current);
        chain.unshift(current);
        current = allCategories.find((c) => c.id === current)?.parentId ?? null;
      }
      return chain;
    },
    [allCategories]
  );

  const ancestorsOf = useCallback(
    (id: string): Category[] => {
      const chain = buildAncestorChain(id);
      return chain.slice(0, -1).map((cid) => categoryById(cid)).filter((c): c is Category => !!c);
    },
    [buildAncestorChain, categoryById]
  );

  const categoryMatches = useCallback(
    (listingCategoryId: string, filterCategoryId: string) => {
      if (listingCategoryId === filterCategoryId) return true;
      return buildAncestorChain(listingCategoryId).includes(filterCategoryId);
    },
    [buildAncestorChain]
  );

  // True if `categoryId` or any of its ancestors is flagged as a services
  // category -- e.g. everything under "Services" is a service even though
  // only the top-level "services" row has isService set, not each leaf.
  const isServiceCategory = useCallback(
    (categoryId: string): boolean => {
      const chain = buildAncestorChain(categoryId);
      return chain.some((cid) => categoryById(cid)?.isService);
    },
    [buildAncestorChain, categoryById]
  );

  // What `condition` means for this category: the nearest row in its
  // ancestry (itself included) that names a mode, or New/Used if none
  // does. Every screen that used to ask "is this Properties?" to decide
  // how to label and populate the condition picker asks this instead, so
  // a new kind of category is a database change rather than a code one.
  const conditionModeForCategory = useCallback(
    (categoryId: string): ConditionMode => {
      // Root-first, so walking it backwards is nearest-first: a leaf that
      // names its own mode overrides the branch it hangs off, which is
      // how live animals and pet supplies live under one parent. A named
      // 'new_used' counts as an answer, not as an absence -- that is the
      // whole reason the column is nullable.
      const chain = buildAncestorChain(categoryId);
      for (let i = chain.length - 1; i >= 0; i--) {
        const mode = categoryById(chain[i])?.conditionMode;
        if (mode) return mode;
      }
      return 'new_used';
    },
    [buildAncestorChain, categoryById]
  );
  // Which attribute labels a listing card in this category, or null to use
  // the category's own name. Same nearest-first walk as
  // conditionModeForCategory above, and for the same reason: a leaf inherits
  // this from the branch it hangs off, so reading it off the row would make
  // every subcategory answer only for itself.
  const cardKindSlugForCategory = useCallback(
    (categoryId: string): string | null => {
      const chain = buildAncestorChain(categoryId);
      for (let i = chain.length - 1; i >= 0; i--) {
        const slug = categoryById(chain[i])?.cardKindSlug;
        if (slug) return slug;
      }
      return null;
    },
    [buildAncestorChain, categoryById]
  );

  // The condition badge's counterpart to cardKindSlugForCategory above, walked
  // the same way and for the same reason. Kept as its own function rather than
  // one generic "resolve a card slug" helper taking a field name: two callers
  // is not enough shared shape to be worth a layer of indirection between an
  // admin toggle and what a buyer reads on a card.
  const cardConditionSlugForCategory = useCallback(
    (categoryId: string): string | null => {
      const chain = buildAncestorChain(categoryId);
      for (let i = chain.length - 1; i >= 0; i--) {
        const slug = categoryById(chain[i])?.cardConditionSlug;
        if (slug) return slug;
      }
      return null;
    },
    [buildAncestorChain, categoryById]
  );

  const usesOfferTypeCategory = useCallback(
    (categoryId: string): boolean => conditionModeForCategory(categoryId) === 'offer_type',
    [conditionModeForCategory]
  );

  // Same nearest-first walk as conditionModeForCategory above. The number
  // it returns is for DISPLAY only -- "expires in N days", and the label
  // on the Extend button. Every write of expires_at happens server-side
  // (the trg_set_listing_expiry trigger on insert, extend_own_listing and
  // republish_own_listing on renewal), because a lifetime the client
  // computes is a lifetime that drifts the first time a second client
  // exists. See LIFECYCLE.md.
  const lifetimeDaysForCategory = useCallback(
    (categoryId: string): number => {
      const chain = buildAncestorChain(categoryId);
      for (let i = chain.length - 1; i >= 0; i--) {
        const days = categoryById(chain[i])?.listingLifetimeDays;
        if (typeof days === 'number' && days > 0) return days;
      }
      // Matches myazar.category_lifetime_days' own fallback. If you change
      // one, change the other -- they are two halves of one answer.
      return DEFAULT_LISTING_LIFETIME_DAYS;
    },
    [buildAncestorChain, categoryById]
  );

  const domainById = useCallback(
    (id: string) => allDomains.find((d) => d.id === id),
    [allDomains]
  );

  // Active top-level categories in a domain. Top-level only: domain_id is
  // set on those rows and inherited downward, so filtering the flat list
  // on it naturally yields exactly the tiles a domain should show.
  const categoriesInDomain = useCallback(
    (domainId: string): Category[] =>
      allCategories
        .filter((c) => c.active && c.parentId === null && c.domainId === domainId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [allCategories]
  );

  // Only domains that are themselves active AND have something to show.
  // That second half is what keeps Jobs & Services off the gate while its
  // two categories are switched off, without a separate flag to remember.
  const domains = useMemo(
    () =>
      allDomains
        .filter((d) => d.active && categoriesInDomain(d.id).length > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [allDomains, categoriesInDomain]
  );

  // Walks to the top-level ancestor, since that is the only row carrying
  // domain_id -- asking a leaf directly would always answer null.
  const domainOfCategory = useCallback(
    (categoryId: string): ListingDomain | undefined => {
      const chain = buildAncestorChain(categoryId);
      for (const cid of chain) {
        const d = categoryById(cid)?.domainId;
        if (d) return domainById(d);
      }
      return undefined;
    },
    [buildAncestorChain, categoryById, domainById]
  );

  const resolveAttributesForCategory = useCallback(
    (categoryId: string): CategoryAttribute[] => {
      const chain = buildAncestorChain(categoryId); // root -> leaf, includes categoryId
      const bySlug = new Map<string, CategoryAttribute>();
      const order: string[] = [];
      chain.forEach((cid) => {
        const own = allCategoryAttributes
          .filter((a) => a.categoryId === cid)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        own.forEach((attr) => {
          if (!bySlug.has(attr.slug)) order.push(attr.slug);
          bySlug.set(attr.slug, attr); // a more specific (child) definition wins on slug collision
        });
      });
      return order.map((slug) => bySlug.get(slug)!);
    },
    [buildAncestorChain, allCategoryAttributes]
  );

  const resolveFilterFacetsForCategory = useCallback(
    (categoryId: string): FilterFacet[] => {
      const chain = buildAncestorChain(categoryId); // root -> leaf, includes categoryId
      const facets: FilterFacet[] = [];
      let sawArea = false;
      let sawSubcategory = false;
      chain.forEach((cid) => {
        const cat = categoryById(cid);
        if (!cat) return;
        const levelFacets: FilterFacet[] = [];
        // Only offer "pick a subcategory" where there actually are
        // subcategories to pick -- a leaf with a stale priority value
        // (e.g. after its last child was deleted) just quietly drops it.
        if (!sawSubcategory && cat.subcategoryFilterPriority != null && childrenOf(cid).length > 0) {
          levelFacets.push({ kind: 'subcategory', priority: cat.subcategoryFilterPriority });
          sawSubcategory = true;
        }
        if (!sawArea && cat.areaFilterPriority != null) {
          levelFacets.push({ kind: 'area', priority: cat.areaFilterPriority });
          sawArea = true;
        }
        allCategoryAttributes
          .filter((a) => a.categoryId === cid && a.filterPriority != null)
          .forEach((attr) => levelFacets.push({ kind: 'attribute', priority: attr.filterPriority as number, attribute: attr }));
        levelFacets.sort((a, b) => a.priority - b.priority);
        facets.push(...levelFacets);
      });
      return facets;
    },
    [buildAncestorChain, categoryById, childrenOf, allCategoryAttributes]
  );

  const createCategory = useCallback(
    async (input: CreateCategoryInput) => {
      const siblings = allCategories.filter((c) => (c.parentId || null) === (input.parentId || null));
      const nextSortOrder = siblings.length > 0 ? Math.max(...siblings.map((c) => c.sortOrder)) + 1 : 0;
      const { error } = await supabase.from('categories').insert({
        id: input.id,
        slug: input.id,
        parent_id: input.parentId || null,
        name_en: input.nameEn,
        name_ar: input.nameAr,
        icon_url: input.iconUrl || null,
        supports_3d: input.supports3d,
        required_shot_list: input.shotListEn,
        required_shot_list_ar: input.shotListAr,
        sort_order: nextSortOrder,
        active: true,
        is_service: input.isService,
        condition_mode: input.conditionMode,
        card_kind_slug: input.cardKindSlug,
        card_condition_slug: input.cardConditionSlug,
        listing_lifetime_days: input.listingLifetimeDays,
        domain_id: input.domainId,
        title_example_en: input.titleExampleEn,
        title_example_ar: input.titleExampleAr,
        description_example_en: input.descriptionExampleEn,
        description_example_ar: input.descriptionExampleAr,
        stock_mode: input.stockMode,
      });
      if (error) throw new Error(friendlyError(error, 'category'));
      await refreshFromSupabase();
    },
    [allCategories, refreshFromSupabase]
  );

  const updateCategory = useCallback(
    async (id: string, patch: Partial<UpdateCategoryPatch>) => {
      if (patch.parentId !== undefined && patch.parentId === id) {
        throw new Error('A category cannot be its own parent.');
      }
      const dbPatch: Record<string, any> = {};
      if (patch.parentId !== undefined) dbPatch.parent_id = patch.parentId;
      if (patch.nameEn !== undefined) dbPatch.name_en = patch.nameEn;
      if (patch.nameAr !== undefined) dbPatch.name_ar = patch.nameAr;
      if (patch.iconUrl !== undefined) dbPatch.icon_url = patch.iconUrl;
      if (patch.supports3d !== undefined) dbPatch.supports_3d = patch.supports3d;
      if (patch.shotListEn !== undefined) dbPatch.required_shot_list = patch.shotListEn;
      if (patch.shotListAr !== undefined) dbPatch.required_shot_list_ar = patch.shotListAr;
      if (patch.active !== undefined) dbPatch.active = patch.active;
      if (patch.isService !== undefined) dbPatch.is_service = patch.isService;
      if (patch.conditionMode !== undefined) dbPatch.condition_mode = patch.conditionMode;
      if (patch.listingLifetimeDays !== undefined) dbPatch.listing_lifetime_days = patch.listingLifetimeDays;
      if (patch.cardKindSlug !== undefined) dbPatch.card_kind_slug = patch.cardKindSlug;
      if (patch.cardConditionSlug !== undefined) dbPatch.card_condition_slug = patch.cardConditionSlug;
      if (patch.domainId !== undefined) dbPatch.domain_id = patch.domainId;
      if (patch.titleExampleEn !== undefined) dbPatch.title_example_en = patch.titleExampleEn;
      if (patch.titleExampleAr !== undefined) dbPatch.title_example_ar = patch.titleExampleAr;
      if (patch.descriptionExampleEn !== undefined) dbPatch.description_example_en = patch.descriptionExampleEn;
      if (patch.descriptionExampleAr !== undefined) dbPatch.description_example_ar = patch.descriptionExampleAr;
      if (patch.stockMode !== undefined) dbPatch.stock_mode = patch.stockMode;

      // Update local state immediately so the admin UI feels instant, with a
      // rollback for the refused write -- a switch that stays on after
      // "Could not save" is worse than a slow one.
      //
      // Three details, all from AGENTS.md's note that a plain restore is not
      // enough. The previous value is captured INSIDE the updater, not read
      // from this callback's render closure, which would be one render stale
      // the moment two writes overlap. The rollback restores only THIS row
      // rather than reassigning the array, so it cannot throw away a change
      // to a different category that landed while this one was in flight.
      // And the sequence guard above stops a late failure undoing a newer
      // success.
      const seq = (updateCategorySeq.get(id) ?? 0) + 1;
      updateCategorySeq.set(id, seq);

      let before: Category | undefined;
      setAllCategories((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          before = c;
          return { ...c, ...patch };
        })
      );

      const { error } = await supabase.from('categories').update(dbPatch).eq('id', id);
      if (error) {
        // Only the newest write for this row may roll back. An older one
        // finishing late would otherwise restore a value from before a newer
        // write that has already succeeded -- the admin would watch their
        // text revert under an alert about a different, earlier failure.
        const restore = before;
        if (restore && updateCategorySeq.get(id) === seq) {
          setAllCategories((prev) => prev.map((c) => (c.id === id ? restore : c)));
        }
        throw new Error(friendlyError(error, 'category'));
      }
      await refreshFromSupabase();
    },
    [refreshFromSupabase]
  );

  const reorderCategories = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      setAllCategories((prev) =>
        prev.map((c) => {
          const idx = orderedIds.indexOf(c.id);
          return idx === -1 ? c : { ...c, sortOrder: idx };
        })
      );
      const results = await Promise.all(
        orderedIds.map((id, idx) => supabase.from('categories').update({ sort_order: idx }).eq('id', id))
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(friendlyError(failed.error, 'category'));
      await refreshFromSupabase();
    },
    [refreshFromSupabase]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const hasChildren = allCategories.some((c) => c.parentId === id);
      if (hasChildren) {
        throw new Error('This category has subcategories. Delete or move them first.');
      }
      const { count, error: countErr } = await supabase
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id);
      if (countErr) throw new Error(friendlyError(countErr, 'category'));
      if (count && count > 0) {
        throw new Error(
          `${count} listing${count === 1 ? '' : 's'} still use this category. Deactivate it instead of deleting so those listings keep working.`
        );
      }
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw new Error(friendlyError(error, 'category'));
      await refreshFromSupabase();
    },
    [allCategories, refreshFromSupabase]
  );

  const createAttribute = useCallback(
    async (input: CreateAttributeInput) => {
      const own = allCategoryAttributes.filter((a) => a.categoryId === input.categoryId);
      const nextSortOrder = own.length > 0 ? Math.max(...own.map((a) => a.sortOrder)) + 1 : 0;
      const { error } = await supabase.from('category_attributes').insert({
        category_id: input.categoryId,
        slug: input.slug,
        label_en: input.labelEn,
        label_ar: input.labelAr,
        type: input.type,
        options: input.options,
        unit_en: input.unitEn || null,
        unit_ar: input.unitAr || null,
        required: input.required,
        sort_order: nextSortOrder,
        is_variant: input.isVariant,
        card_priority: input.cardPriority,
        icon: input.icon,
      });
      if (error) throw new Error(friendlyError(error, 'attribute'));
      await refreshFromSupabase();
    },
    [allCategoryAttributes, refreshFromSupabase]
  );

  const updateAttribute = useCallback(
    async (id: string, patch: Partial<UpdateAttributePatch>) => {
      const dbPatch: Record<string, any> = {};
      if (patch.labelEn !== undefined) dbPatch.label_en = patch.labelEn;
      if (patch.labelAr !== undefined) dbPatch.label_ar = patch.labelAr;
      if (patch.type !== undefined) dbPatch.type = patch.type;
      if (patch.options !== undefined) dbPatch.options = patch.options;
      if (patch.unitEn !== undefined) dbPatch.unit_en = patch.unitEn;
      if (patch.unitAr !== undefined) dbPatch.unit_ar = patch.unitAr;
      if (patch.required !== undefined) dbPatch.required = patch.required;
      if (patch.isVariant !== undefined) dbPatch.is_variant = patch.isVariant;
      if (patch.cardPriority !== undefined) dbPatch.card_priority = patch.cardPriority;
      if (patch.icon !== undefined) dbPatch.icon = patch.icon;

      // Capture-inside-the-updater, restore-one-row, and the same sequence
      // guard -- see updateCategory above for all three reasons.
      const seq = (updateAttributeSeq.get(id) ?? 0) + 1;
      updateAttributeSeq.set(id, seq);

      let before: CategoryAttribute | undefined;
      setAllCategoryAttributes((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          before = a;
          return { ...a, ...patch };
        })
      );

      const { error } = await supabase.from('category_attributes').update(dbPatch).eq('id', id);
      if (error) {
        const restore = before;
        if (restore && updateAttributeSeq.get(id) === seq) {
          setAllCategoryAttributes((prev) => prev.map((a) => (a.id === id ? restore : a)));
        }
        throw new Error(friendlyError(error, 'attribute'));
      }
      await refreshFromSupabase();
    },
    [refreshFromSupabase]
  );

  const deleteAttribute = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('category_attributes').delete().eq('id', id);
      if (error) throw new Error(friendlyError(error, 'attribute'));
      await refreshFromSupabase();
    },
    [refreshFromSupabase]
  );

  const reorderAttributes = useCallback(
    async (categoryId: string, orderedIds: string[]) => {
      setAllCategoryAttributes((prev) =>
        prev.map((a) => {
          const idx = orderedIds.indexOf(a.id);
          return idx === -1 ? a : { ...a, sortOrder: idx };
        })
      );
      const results = await Promise.all(
        orderedIds.map((id, idx) => supabase.from('category_attributes').update({ sort_order: idx }).eq('id', id))
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(friendlyError(failed.error, 'attribute'));
      await refreshFromSupabase();
    },
    [refreshFromSupabase]
  );

  const setFilterPriorities = useCallback(
    async (categoryId: string, orderedFacetKeys: string[]) => {
      const cat = categoryById(categoryId);
      if (!cat) throw new Error('Unknown category.');
      const ownAttrs = allCategoryAttributes.filter((a) => a.categoryId === categoryId);

      const priorityFor = (key: string) => {
        const idx = orderedFacetKeys.indexOf(key);
        return idx === -1 ? null : idx + 1;
      };
      const nextAreaPriority = priorityFor('area');
      const nextSubcategoryPriority = priorityFor('subcategory');

      // Update local state immediately so the admin UI feels instant.
      setAllCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, areaFilterPriority: nextAreaPriority, subcategoryFilterPriority: nextSubcategoryPriority } : c
        )
      );
      setAllCategoryAttributes((prev) =>
        prev.map((a) => (a.categoryId === categoryId ? { ...a, filterPriority: priorityFor(a.slug) } : a))
      );

      const results = await Promise.all([
        supabase
          .from('categories')
          .update({ area_filter_priority: nextAreaPriority, subcategory_filter_priority: nextSubcategoryPriority })
          .eq('id', categoryId),
        ...ownAttrs.map((a) => supabase.from('category_attributes').update({ filter_priority: priorityFor(a.slug) }).eq('id', a.id)),
      ]);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(friendlyError(failed.error, 'attribute'));
      await refreshFromSupabase();
    },
    [categoryById, allCategoryAttributes, refreshFromSupabase]
  );

  const updateSiteSettings = useCallback(
    async (patch: Partial<SiteSettings>) => {
      const dbPatch: Record<string, any> = {};
      if (patch.brandPrimaryColor !== undefined) dbPatch.brand_primary_color = patch.brandPrimaryColor;
      if (patch.brandAccentColor !== undefined) dbPatch.brand_accent_color = patch.brandAccentColor;
      if (patch.logoEnUrl !== undefined) dbPatch.logo_en_url = patch.logoEnUrl;
      if (patch.logoArUrl !== undefined) dbPatch.logo_ar_url = patch.logoArUrl;
      if (patch.faviconUrl !== undefined) dbPatch.favicon_url = patch.faviconUrl;

      const next = { ...siteSettings, ...patch };
      applySiteSettings(next);

      const { error } = await supabase.from('site_settings').update(dbPatch).eq('id', true);
      if (error) throw new Error(friendlyError(error, 'category'));
      AsyncStorage.setItem(KEYS.siteSettings, JSON.stringify(next)).catch(() => {});
    },
    [siteSettings, applySiteSettings]
  );

  // Admin sign-in/up both swap the Supabase client's active session over
  // to a real (non-anonymous) account -- AppStore listens for that auth
  // change and re-syncs listings/profile under the new identity, so the
  // rest of the app keeps working correctly while acting as admin.
  //
  // Neither of these sets isAdmin true anymore -- a password match is
  // only aal1. Every admin login now has to also clear a TOTP challenge
  // (adminMfaVerify) before isAdmin flips on; see AdminGateScreen and
  // AuthScreen's admin branch for the enroll-vs-challenge step this
  // return value drives.
  const adminSignIn = useCallback(async (email: string, password: string): Promise<{ error?: string; status?: 'needsEnroll' | 'needsChallenge'; factorId?: string }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    const uid = data.user?.id;
    const { data: row } = await supabase.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
    if (!row) {
      // Not an admin yet -- but this may be someone signing in with an
      // account that already existed in this shared Supabase project (from
      // another app) rather than one created via the "set up" form. Try to
      // claim the one-time bootstrap slot the same way sign-up would; the
      // RLS policy only allows this insert while myazar.admins is still
      // empty, so it's safe to attempt here without weakening security --
      // it just means "sign in" and "set up" both work as the bootstrap
      // path for whichever account is used first.
      const { error: insertErr } = await supabase.from('admins').insert({ user_id: uid });
      if (insertErr) {
        await supabase.auth.signOut();
        return { error: 'This account is not an admin.' };
      }
    }
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find((f) => f.status === 'verified');
    if (!verified) return { status: 'needsEnroll' };
    return { status: 'needsChallenge', factorId: verified.id };
  }, []);

  const adminBootstrapSignUp = useCallback(async (email: string, password: string): Promise<{ error?: string; status?: 'needsEnroll' }> => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    const uid = data.user?.id;
    if (!uid || !data.session) {
      return { error: 'Sign-up did not return an active session -- check the Supabase Auth email-confirmation setting.' };
    }
    const { error: insertErr } = await supabase.from('admins').insert({ user_id: uid });
    if (insertErr) {
      await supabase.auth.signOut();
      return { error: 'Could not claim admin -- an admin account already exists. Sign in instead.' };
    }
    // A brand-new admin obviously has no TOTP factor yet.
    return { status: 'needsEnroll' };
  }, []);

  // Starts TOTP enrollment -- returns an SVG QR code (as a data-URL-ready
  // string) and the plain-text secret as a fallback for scanning. The
  // factor is `unverified` until adminMfaVerify below succeeds against it.
  const adminEnrollMfaStart = useCallback(async (): Promise<{ error?: string; factorId?: string; qrCode?: string; secret?: string }> => {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Admin device ${Date.now()}` });
    if (error) return { error: error.message };
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }, []);

  // Clears a TOTP challenge against `factorId` -- the one function that
  // actually flips isAdmin on, whether it's confirming a brand-new
  // enrollment or a returning admin's existing factor. Also clears
  // sessionLocked, so this doubles as the lock screen's full fallback
  // unlock path (see getVerifiedTotpFactorId for how that path gets a
  // factorId without a fresh adminSignIn call).
  const adminMfaVerify = useCallback(async (factorId: string, code: string): Promise<{ error?: string }> => {
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) return { error: challenge.error.message };
    const verify = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    if (verify.error) return { error: verify.error.message };
    setIsAdmin(true);
    setAdminChecked(true);
    setSessionLocked(false);
    recordActivity();
    return {};
  }, [recordActivity]);

  const getVerifiedTotpFactorId = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.mfa.listFactors();
    return data?.totp?.find((f) => f.status === 'verified')?.id ?? null;
  }, []);

  const adminSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // Ignore -- we still want to fall through to re-establishing a
      // fresh anonymous session below.
    }
    setIsAdmin(false);
    setSessionLocked(false);
    await ensureSession();
  }, []);

  // Registers this device's platform authenticator (Face ID/fingerprint)
  // as a fast unlock path. Purely local -- see bufferToBase64Url's
  // comment above for why the credential is never sent anywhere for
  // verification; it only ever gates re-entry into an already-verified,
  // still-live session after the auto-lock timer fires.
  const registerBiometricCredential = useCallback(async (): Promise<{ error?: string }> => {
    if (!biometricSupported) return { error: 'Not supported on this device/browser.' };
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) return { error: 'Not signed in.' };
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const cred: any = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Vevaty Admin' },
          user: { id: new TextEncoder().encode(uid), name: 'admin', displayName: 'Vevaty Admin' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60000,
        } as any,
      });
      if (!cred) return { error: 'Could not register.' };
      const credId = bufferToBase64Url((cred as any).rawId);
      await AsyncStorage.setItem(KEYS.adminBiometricCredId, credId);
      setHasBiometricCredential(true);
      return {};
    } catch (e: any) {
      return { error: e?.message || 'Could not enable fingerprint unlock.' };
    }
  }, [biometricSupported]);

  // The lock screen's fast path -- a successful local biometric prompt
  // clears sessionLocked directly, with no server round-trip (the
  // underlying session/aal2 status never changed; this only re-opens the
  // app's own UI). Falls through to an error the caller can use to show
  // the full password+TOTP fallback form instead.
  const tryBiometricUnlock = useCallback(async (): Promise<{ error?: string }> => {
    if (!biometricSupported) return { error: 'Not supported on this device/browser.' };
    try {
      const credId = await AsyncStorage.getItem(KEYS.adminBiometricCredId);
      if (!credId) return { error: 'No fingerprint unlock registered on this device.' };
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: base64UrlToBuffer(credId), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000,
        } as any,
      });
      if (!assertion) return { error: 'Unlock cancelled.' };
      setSessionLocked(false);
      recordActivity();
      return {};
    } catch (e: any) {
      return { error: e?.message || 'Could not unlock with fingerprint.' };
    }
  }, [biometricSupported, recordActivity]);

  const value = useMemo(
    () => ({
      ready,
      categories,
      allCategories: sortedAll,
      categoryById,
      childrenOf,
      ancestorsOf,
      categoryMatches,
      isServiceCategory,
      conditionModeForCategory,
      cardKindSlugForCategory,
      cardConditionSlugForCategory,
      lifetimeDaysForCategory,
      usesOfferTypeCategory,
      domains,
      allDomains,
      domainById,
      domainOfCategory,
      categoriesInDomain,
      categoryAttributes: allCategoryAttributes,
      resolveAttributesForCategory,
      resolveFilterFacetsForCategory,
      siteSettings,
      isAdmin,
      adminChecked,
      refreshIsAdmin: checkIsAdmin,
      createCategory,
      updateCategory,
      reorderCategories,
      deleteCategory,
      createAttribute,
      updateAttribute,
      deleteAttribute,
      reorderAttributes,
      setFilterPriorities,
      updateSiteSettings,
      adminSignIn,
      adminBootstrapSignUp,
      adminEnrollMfaStart,
      adminMfaVerify,
      getVerifiedTotpFactorId,
      adminSignOut,
      sessionLocked,
      lockDurationMinutes,
      setLockDuration,
      recordActivity,
      biometricSupported,
      hasBiometricCredential,
      registerBiometricCredential,
      tryBiometricUnlock,
    }),
    [
      ready,
      categories,
      sortedAll,
      categoryById,
      childrenOf,
      ancestorsOf,
      categoryMatches,
      isServiceCategory,
      conditionModeForCategory,
      cardKindSlugForCategory,
      cardConditionSlugForCategory,
      lifetimeDaysForCategory,
      usesOfferTypeCategory,
      domains,
      allDomains,
      domainById,
      domainOfCategory,
      categoriesInDomain,
      allCategoryAttributes,
      resolveAttributesForCategory,
      resolveFilterFacetsForCategory,
      siteSettings,
      isAdmin,
      adminChecked,
      checkIsAdmin,
      createCategory,
      updateCategory,
      reorderCategories,
      deleteCategory,
      createAttribute,
      updateAttribute,
      deleteAttribute,
      reorderAttributes,
      setFilterPriorities,
      updateSiteSettings,
      adminSignIn,
      adminBootstrapSignUp,
      adminEnrollMfaStart,
      adminMfaVerify,
      getVerifiedTotpFactorId,
      adminSignOut,
      sessionLocked,
      lockDurationMinutes,
      setLockDuration,
      recordActivity,
      biometricSupported,
      hasBiometricCredential,
      registerBiometricCredential,
      tryBiometricUnlock,
    ]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
