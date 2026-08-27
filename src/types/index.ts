// Category ids used to be a fixed union (electronics | vehicles | ...).
// Categories are now admin-managed rows in Supabase (myazar.categories),
// so any string is a valid id -- new categories the admin creates don't
// need a code change or redeploy to be usable everywhere a CategoryId
// used to be required.
export type CategoryId = string;

export interface Category {
  id: CategoryId; // stable slug, also the id stored on listings.category_id
  // Top-level categories have parentId === null. A category with a
  // parentId is a subcategory (e.g. Apartments under Properties) --
  // the app currently supports one level of nesting in its UI, though
  // the data model itself allows deeper chains.
  parentId: CategoryId | null;
  nameEn: string;
  nameAr: string;
  // Admin-uploaded custom icon image, hosted on vevaty.com.
  // Preferred over `icon` whenever set.
  iconUrl: string | null;
  // Fallback to the built-in icon set (src/icons/Icon.tsx) when no
  // iconUrl is set yet -- keeps the six original categories looking
  // right even before an admin uploads custom art for them.
  icon: string;
  supports3d: boolean;
  shotListEn: string[];
  shotListAr: string[];
  // Prompts for the "verification shot" step (CreateListingScreen's
  // 'verify' step, right after Classify): unlike shotListEn/Ar (angle
  // photos of the item itself, shown during ordinary Photos capture),
  // these ask for one specific, information-dense photo -- a settings
  // screen, a VIN plate, a rating label -- that the AI spec suggestion
  // reads printed facts off instead of guessing them from appearance. Most
  // categories have zero (empty array = no verify step at all); vehicles
  // have two (VIN plate, odometer). See useAiSpecSuggestion.ts.
  verificationShotListEn: string[];
  verificationShotListAr: string[];
  sortOrder: number;
  active: boolean;
  // A services category (e.g. plumbing, tutoring) rather than a
  // physical item for sale/rent -- changes the listing detail page's
  // call-to-action to "Contact to hire".
  isService: boolean;
  // 'unique' (the default, and every category until this field existed):
  // a listing is one specific physical item -- an apartment, a car, a
  // single phone -- so stock/variant intake never shows on the create
  // form and Listing.stockQty/variants stay at their defaults. 'multiple':
  // a listing represents a stocked product a shop carries more than one
  // of (typically clothing/accessories) -- CreateListingScreen shows a
  // stock-intake step, either per-variant (if the category has an
  // is_variant attribute, e.g. "Size") or a single quantity field.
  stockMode: 'unique' | 'multiple';
  // Shown as the placeholder text on the title/description fields when
  // posting a listing in this category, so the example is relevant
  // (an apartment listing shouldn't see a hardcoded phone example).
  // Falls back to a generic placeholder when unset.
  titleExampleEn: string | null;
  titleExampleAr: string | null;
  descriptionExampleEn: string | null;
  descriptionExampleAr: string | null;
  // Where the "Area" and "pick a subcategory" steps fall in this
  // category's Home-screen filter drill-down (see FilterFacet below).
  // null = that step isn't offered as a filter for this category.
  areaFilterPriority: number | null;
  subcategoryFilterPriority: number | null;
}

// The kind of input a category attribute's value should be collected
// with. `select`/`multiselect` use `options`; `number` and `text` are
// free entry; `boolean` is a yes/no switch.
export type AttributeType = 'text' | 'number' | 'select' | 'multiselect' | 'boolean';

export interface AttributeOption {
  value: string;
  labelEn: string;
  labelAr: string;
}

// A single spec field an admin has defined for a category -- e.g.
// "Bedrooms" (number) on Properties, or "Resolution" (select) on TVs.
// Attributes defined on a parent category are inherited by all of its
// subcategories (resolved in SettingsStore, not duplicated in the DB).
export interface CategoryAttribute {
  id: string;
  categoryId: CategoryId;
  slug: string;
  labelEn: string;
  labelAr: string;
  type: AttributeType;
  options: AttributeOption[];
  unitEn: string | null;
  unitAr: string | null;
  required: boolean;
  sortOrder: number;
  // Position of this attribute in its OWN category's Home-screen filter
  // drill-down sequence (see FilterFacet below). null = this attribute
  // is a spec/create-form field only, not offered as a search filter.
  // Separate from sortOrder, which only governs spec/create-form order.
  filterPriority: number | null;
  // For a 'number' attribute used as a filter, which end of the range
  // this attribute's own value represents -- e.g. a car's "Year" is a
  // 'min' bound ("Year from"), its "Mileage" a 'max' bound ("Mileage up
  // to"). Not yet consumed anywhere (HomeScreen/StorefrontScreen both
  // show a full min-max range regardless); carried on the type now since
  // the DB column already exists, left for a future refinement.
  bound: 'min' | 'max' | null;
  // Which spec values print directly on a listing card (vs. only showing
  // on the detail page), in order. Not yet consumed anywhere -- carried
  // on the type now since the DB column already exists, left for a
  // future refinement.
  cardPriority: number | null;
  // True for the one attribute (must be 'multiselect' -- see the admin
  // toggle in AdminCategoryAttributesScreen) a 'multiple' stock-mode
  // category uses to break a listing's stock into variants, e.g. "Size"
  // on a clothing category. See Listing.variants for how a listing's
  // per-variant stock is actually stored; this attribute's own value on
  // such a listing is always exactly the list of variant values that
  // currently have stock > 0 (kept in sync by CreateListingScreen), so
  // every existing multiselect-based filter/spec-display path already
  // works for it with no special-casing.
  isVariant: boolean;
}

// One step in a category's Home-screen filter drill-down, in the order
// the admin has configured (via categories.area_filter_priority /
// subcategory_filter_priority and category_attributes.filter_priority).
// Resolved by SettingsStore's resolveFilterFacetsForCategory.
export type FilterFacet =
  | { kind: 'subcategory'; priority: number }
  | { kind: 'area'; priority: number }
  | { kind: 'attribute'; priority: number; attribute: CategoryAttribute };

// The value a listing stores for one attribute slug. Multiselect stores
// an array of option values; everything else stores a single value.
export type AttributeValue = string | number | boolean | string[];

export type PaymentMethod = 'whish' | 'cash_confirmation' | 'card';

// One named 360° spin (e.g. "Exterior"/"Interior" for a car, or one per
// room for a property) -- a listing can have zero, one, or several. `id`
// is a client-generated id for brand-new sets (before the listing/set is
// ever saved) and becomes the real myazar.listing_spin_sets row id once
// synced from Supabase (see dbListingToLocal in AppStore.tsx) -- either
// way it's only used as a React key and to target retake/remove/rename
// actions at the right set, never sent back to the server as-is.
export interface SpinSet {
  id: string;
  label: string;
  frames: string[]; // same local-uri-then-hosted-url lifecycle as photos, in capture order
}

// A listing's optional video, hosted on Bunny Stream (see
// src/lib/bunnyVideo.ts). One per listing, 60 seconds at most.
//
// Only `guid` is stored server-side -- every URL (playback, thumbnail,
// preview) is derived from it, so there are no stored URLs to migrate if
// the CDN hostname ever changes. `status` walks uploading -> processing ->
// ready: 'ready' is the only status anyone but the seller can ever see,
// because a half-encoded video would just be a broken player on a public
// listing. `height` is the SOURCE height Bunny reports, and it decides
// which MP4 rendition actually exists -- Bunny never upscales.
export interface ListingVideo {
  guid: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  durationS: number | null;
  width: number | null;
  height: number | null;
  // Rendition heights Bunny actually produced, ascending (e.g. [360, 720]).
  // Null for videos encoded before this was recorded. Never infer this from
  // `height`: Bunny doesn't upscale, and which resolutions get generated is a
  // library setting that can change between one upload and the next.
  resolutions: number[] | null;
}

export interface Listing {
  id: string;
  cat: CategoryId;
  // Stored in both languages -- either from the seller writing both
  // themselves, or from the auto-translate suggestion they reviewed
  // when posting. Use pickText() (src/lib/listingText.ts) to read the
  // right one for the current UI language with a same-listing fallback.
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  price: number;
  // Whether the item is brand new or used, chosen by the seller as a
  // required pick on the very first step of the create-listing wizard
  // (see CreateListingScreen's category step). Nullable only for the sake
  // of listings posted before this field existed -- see normalizeListing/
  // dbListingToLocal's defensive-default story for the same reasoning
  // applied elsewhere on this type. A null condition simply shows no
  // New/Used badge on ListingCard rather than guessing.
  condition: 'new' | 'used' | null;
  district: string;
  // Lebanese governorate/caza (district), resolved via the map picker or
  // town-name autocomplete against the lebanonPlaces dataset (see
  // src/data/lebanonPlaces.ts). Nullable -- `district` above remains the
  // source-of-truth freeform display string; these are purely additive and
  // stay null for listings posted before this feature or where the typed
  // town didn't match anything in the dataset.
  governorate: string | null;
  caza: string | null;
  // GeoNames geonameid of the resolved town/village, if any -- lets
  // governorate/caza be re-derived deterministically after a future
  // dataset refresh.
  geonameId: number | null;
  // Approximate coordinates for the "distance from me" filter -- captured
  // from the seller's device geolocation when they post, or derived from
  // the resolved place/district via lebanonPlaces as a fallback. null when
  // neither was available; such listings are simply excluded while a buyer
  // has the distance filter actively set (see HomeScreen).
  lat: number | null;
  lng: number | null;
  photos: string[]; // local file uris
  // The first gallery photo's small (~400px) card-thumbnail variant, if one
  // was generated at upload time -- null for any listing posted before this
  // existed (see the listing_photos.thumbnail_url migration) or while a
  // brand-new listing's photos are still uploading in the background. Cards
  // fall back to sizing down the full photo when this is null, exactly like
  // they always have -- see ListingCard's use of this. Only the cover photo
  // gets one: it's the only photo a card ever shows, so a thumbnail per
  // gallery photo would be uploaded and never read.
  coverThumbnailUrl?: string | null;
  // One or more named 360° spins -- e.g. a car might have "Exterior" and
  // "Interior" spins, a property one spin per room. Empty array is the
  // common case (no spin at all). Replaces the old flat single-spin
  // `spinPhotos: string[]` field.
  spinSets: SpinSet[];
  // Null for the vast majority of listings -- video is entirely optional,
  // and a listing posted before this feature existed simply has none. See
  // normalizeListing in AppStore.tsx for why that null has to be defaulted
  // at cache-read time rather than trusted.
  video: ListingVideo | null;
  sellerName: string;
  sellerId: string;
  rating: number;
  createdAt: number;
  aiGenerated: boolean;
  // Spec values for this listing's category (and its ancestors), keyed
  // by attribute slug -- e.g. { bedrooms: 3, listing_purpose: 'rent' }.
  attributes: Record<string, AttributeValue>;
  // Lifecycle status -- mirrors myazar.listings.status. 'expired' is shown
  // to the app user as "Unpublished" (see ProfileScreen) rather than using
  // the DB word directly; it's driven by a daily pg_cron job flipping any
  // listing past its expiresAt, not by anything client-side.
  // 'pending_review'/'rejected' are new for the content-moderation feature:
  // every new listing is inserted as 'pending_review' and only a passing AI
  // check or a human moderator (AdminModerationScreen) can move it to
  // 'active'; 'rejected' means a human moderator declined it (see
  // moderationReason) and the seller can edit and resubmit.
  status: 'draft' | 'active' | 'sold' | 'expired' | 'removed' | 'pending_review' | 'rejected';
  // Bookkeeping for WHY status is what it is -- see the moderate-listing
  // edge function and AdminModerationScreen. 'pending' = AI check hasn't
  // resolved yet, 'flagged' = AI declined and it's waiting on a human.
  moderationStatus: 'pending' | 'ai_approved' | 'flagged' | 'human_approved' | 'rejected';
  // Set by a human moderator on rejection; shown to the seller so they know
  // what to fix before resubmitting. Null otherwise.
  moderationReason: string | null;
  // 15 days after posting by default (DB column default), reset to
  // now+15d by extendListing/republishListing. expiryReminderSentAt is set
  // once the day-15 WhatsApp reminder has actually gone out (see the
  // send-expiry-reminders edge function) so it's never sent twice for the
  // same expiry window.
  expiresAt: number;
  expiryReminderSentAt: number | null;
  // Phase 4 item 14 -- which of the contact CTAs (chat / phone+WhatsApp)
  // show on ListingDetailScreen for this listing. 'both' is the default
  // for every existing listing (via the DB column default and the
  // fallback in normalizeListing/dbListingToLocal) so this is purely
  // additive -- nothing already posted loses a contact option.
  contactMethod: 'phone' | 'chat' | 'both';
  // Phase 4 item 16 -- carried on the listing (from a join against the
  // seller's profile row) purely so the seller panel on ListingDetail can
  // show a "Verified" badge and "Member since" line without a second
  // fetch. Mirrors profiles.is_phone_verified / profiles.created_at.
  sellerVerified: boolean;
  sellerMemberSince: number;
  // Same denormalization as sellerVerified/sellerMemberSince, mirroring
  // profiles.avatar_url. Null for the many sellers who haven't set a
  // photo -- the seller panel/profile page fall back to a generic icon.
  sellerAvatarUrl: string | null;
  // Storefronts -- null for the vast majority of listings (a normal
  // seller-posted item has no shop at all). Set when this listing was
  // posted through a merchant's storefront (myazar.listings.shop_id).
  // Denormalized onto the listing at read time (dbListingToLocal, via a
  // `shop:shops(...)` join) the same way sellerName/sellerVerified are --
  // every place that renders a card or the detail page already has what
  // it needs with no second fetch. shopNameEn/shopNameAr mirror
  // titleEn/titleAr's same-listing-fallback pattern; use
  // listingShopName() (src/lib/listingText.ts) to read the right one.
  shopId: string | null;
  shopNameEn: string | null;
  shopNameAr: string | null;
  // vevaty.com/shop/:shopSlug -- what ListingCard's storefront pill and
  // ListingDetailScreen's storefront panel link to (see the Storefront
  // route). Always set together with shopId/shopNameEn/shopNameAr (all
  // four come from the same `shop:shops(...)` join), but kept as its own
  // nullable field rather than derived, since a listing whose shop was
  // since deleted would otherwise dangle.
  shopSlug: string | null;
  // Batch listings -- null for the vast majority of listings (a normal
  // single-item post has no batch at all). Set when this listing was
  // captured as one item of a "sell a bunch of items" session (see
  // src/screens/batch/*.tsx), tagging it with the myazar.batches row that
  // session created. Write-once: set on insert (addListing) and never
  // changed by updateListing, so editing an item later -- even via the
  // ordinary single-item edit form the batch final-review screen reuses to
  // drill into an item -- can never move it out of its batch.
  batchId: string | null;
  // True once the seller has explicitly used a batch item's "save this
  // item as a draft for later" escape hatch (BatchDetailsScreen). Distinct
  // from `status === 'draft'`: every not-yet-finished batch item is ALSO a
  // draft, so status alone can't tell "still queued, just not detailed
  // yet" apart from "seller deliberately parked this one" -- the batch
  // final-review screen needs both counts, and skips parked items when
  // posting the rest of the batch. Meaningless (always false) outside a
  // batch; see batchId above.
  batchParked: boolean;
  // Stock/variants -- see Category.stockMode. `stockQty` is the single
  // source of truth for "does this listing have anything left" (used for
  // the out-of-stock badge/notice regardless of whether it's variant- or
  // plain-quantity-tracked): for a variant listing it's always the sum of
  // every variant's own stockQty (kept in sync by CreateListingScreen,
  // never edited directly); for a plain 'multiple'-mode listing with no
  // is_variant attribute, it's the seller's own entered quantity. Stays
  // at the DB default of 1 (and variants null) for every 'unique'-mode
  // listing, which is still the vast majority of the catalog.
  stockQty: number;
  variants: ListingVariant[] | null;
}

// One size/variant's own stock count on a 'multiple'-mode listing whose
// category has an is_variant attribute -- e.g. { attributes: { size: 'm'
// }, stockQty: 5 }. `attributes` only ever has one key today (the single
// is_variant attribute a category may define), kept as a map rather than
// a bare `{ value: string }` in case a category ever needs more than one
// variant-defining attribute later (e.g. size + color) without another
// schema change.
export interface ListingVariant {
  id: string;
  attributes: Record<string, string>;
  stockQty: number;
}

// A merchant storefront -- myazar.shops. Not carried on every Listing in
// full (only the four display/link fields above are denormalized there);
// StorefrontScreen fetches the full row directly by slug, the same way
// SellerProfileScreen falls back to a direct profiles read for a seller
// with zero active listings.
export interface Shop {
  id: string;
  ownerId: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  taglineEn: string | null;
  taglineAr: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  governorate: string | null;
  caza: string | null;
  addressLine: string | null;
  whatsapp: string | null;
  phone: string | null;
  primaryCategoryId: CategoryId | null;
  // null = not yet verified -- the shop row exists (its owner created it)
  // but isn't publicly visible yet (see shops_select RLS: verified_at is
  // not null OR owner_id = auth.uid()). StorefrontScreen treats a
  // not-yet-verified shop the same as a not-found one for any visitor who
  // isn't its owner.
  verifiedAt: number | null;
  // Set by an admin on decline (AdminShopsScreen), mirrors
  // Listing.moderationReason -- shown to the owner on MyStorefrontScreen so
  // they know what to fix. Cleared automatically the next time the owner
  // saves an edit (same "editing resubmits for review" convention as a
  // rejected listing).
  verificationNote: string | null;
}

// Fields the merchant-facing create/edit form supplies -- everything else
// on Shop (id, ownerId, verifiedAt, verificationNote) is server-assigned
// or admin-only. Mirrors ListingInput's shape in AppStore.tsx.
export type ShopInput = Omit<Shop, 'id' | 'ownerId' | 'slug' | 'verifiedAt' | 'verificationNote'>;

// A "sell a bunch of items" session -- myazar.batches. Created once, the
// moment a seller taps "Sell a bunch of items" on SellHubScreen, and every
// listing captured during that session is tagged with its id (see
// Listing.batchId). `itemCount` is a denormalized convenience for a future
// "my batches" management view -- not yet consumed anywhere client-side;
// the batch screens themselves always derive counts by filtering
// AppStore's own `listings` by batchId rather than trusting this column.
export interface Batch {
  id: string;
  sellerId: string;
  status: 'in_progress' | 'submitted';
  itemCount: number;
  createdAt: number;
}

export interface Profile {
  id: string;
  name: string;
  district: string;
  points: number;
  tier: 'Bronze' | 'Silver' | 'Gold';
  // Bunny CDN URL from the same upload-photo pipeline shop logos use, or
  // null for the large majority of accounts that haven't set one -- the
  // avatar circle falls back to a generic icon in that case.
  avatarUrl: string | null;
}

export interface PointsEvent {
  id: string;
  label: string;
  amount: number;
  createdAt: number;
}

// Phase 4 item 11 -- a conversation between a listing's buyer and seller.
// One thread per (listing, buyer) pair; the seller side is whoever posted
// the listing at thread-creation time. Mirrors myazar.chat_threads exactly
// (see ChatStore.tsx for the mapping and RLS notes).
export interface ChatThread {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  createdAt: number;
}

// A single message inside a ChatThread. Mirrors myazar.chat_messages.
export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: number;
  // Phase 4 item 15 -- 'text' is a normal typed message (every message
  // before this feature, and most since). 'offer' additionally carries
  // offerAmount + offerStatus and renders as a structured card with
  // Accept/Decline actions instead of a plain bubble.
  kind: 'text' | 'offer';
  offerAmount: number | null;
  offerStatus: 'pending' | 'accepted' | 'declined' | null;
}

// Phase 4 item 17 -- a listing a user has saved. One row per (user,
// listing); mirrors myazar.favorites.
export interface Favorite {
  id: string;
  userId: string;
  listingId: string;
  createdAt: number;
}

// The filter state HomeScreen can restore verbatim when a saved search is
// run -- mirrors HomeScreen's own SelectionState plus the free-text query
// (kept here rather than in HomeScreen so both HomeScreen and
// SavedSearchesStore/navigation types can reference it without a circular
// import). Kept structurally identical to SelectionState on purpose: see
// HomeScreen's route.params?.applyCriteria handling.
export interface SavedSearchCriteria {
  query: string;
  subCatIds: string[];
  facetValues: Record<string, string[]>;
  priceMin: number | null;
  priceMax: number | null;
  distanceKm: number | null;
  // New/used -- OR-semantics checkbox selection, same shape and matching
  // rules as subCatIds (zero checked = no filtering; either or both
  // checked narrows to listings with that condition). A listing whose own
  // condition is null (posted before the field existed) never matches a
  // non-empty selection here -- see HomeScreen's `filtered` useMemo.
  condition: string[];
}

// A buyer-saved search -- one row per (user, cat, criteria) the user chose
// to bookmark from the Home filter sidebar/modal. Mirrors
// myazar.saved_searches (see SavedSearchesStore.tsx).
export interface SavedSearch {
  id: string;
  userId: string;
  cat: CategoryId;
  label: string;
  criteria: SavedSearchCriteria;
  createdAt: number;
}

// Site-wide branding, editable live from the admin panel -- no rebuild
// needed for a new color scheme, logo, or favicon to go live.
export interface SiteSettings {
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoEnUrl: string | null;
  logoArUrl: string | null;
  faviconUrl: string | null;
}

// A Home-screen collection (Editor's Picks, Hot Deals, Just Listed) and its
// own shareable page -- see myazar.collections. `kind` decides how it gets
// its listings: 'curated' is hand-picked (see CollectionItem below);
// 'recent' and 'price_drop' are both resolved client-side against whatever
// is already in AppStore's `listings`/CollectionsStore's `priceChanges`,
// never stored as rows of their own. See CollectionsStore.tsx.
export type CollectionKind = 'curated' | 'recent' | 'price_drop';

export interface Collection {
  id: string;
  slug: string;
  kind: CollectionKind;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  active: boolean;
  sortOrder: number;
  // Cap on how many listings a 'recent'/'price_drop' collection resolves
  // to. Meaningless for 'curated' (its size is just however many
  // CollectionItem rows exist), kept anyway so the column always has a
  // sane value rather than needing a kind-conditional read everywhere.
  limitCount: number;
  createdAt: number;
  updatedAt: number;
}

// One hand-picked listing inside a kind='curated' collection, in
// admin-controlled order (position, ascending).
export interface CollectionItem {
  id: string;
  collectionId: string;
  listingId: string;
  position: number;
}

// A managed banner (announcement or ad) in one of five placements -- see
// myazar.banners and the "Vevaty — Managed Banner Placements" design spec
// for the full behavior. Multiple banners can be active in the same slot
// at once; BannerStore picks which one to actually show (a "shuffle bag",
// never the same one twice in a row, equal exposure over time -- see
// BannerStore.tsx).
//
// home_after_editors_picks / home_after_just_listed: the two mobile-home
// placements (mobile site and app only -- desktop's "all categories" grid
// never renders these two, see HomeScreen.tsx's renderCollectionRows).
// Named after the collection they trail rather than a fixed position,
// since the three home collection rows sort by their own admin-editable
// sort_order -- see HomeScreen.tsx for exactly how each anchors itself.
export type BannerSlot =
  | 'sidebar_nav'
  | 'listing_detail_desktop_rail'
  | 'listing_detail_mobile'
  | 'home_after_editors_picks'
  | 'home_after_just_listed';

// Where the banner links to. 'external' is a plain URL; the other three
// are resolved client-side against this app's own navigation -- see
// bannerLink.ts.
export type BannerLinkType = 'external' | 'collection' | 'category' | 'listing';

export interface Banner {
  id: string;
  slot: BannerSlot;
  // Both required -- unlike most other bilingual admin content in this
  // app, there is no fallback from ar to en. See BannerStore's doc
  // comment for why.
  imageUrlEn: string;
  imageUrlAr: string;
  linkType: BannerLinkType;
  // A URL for 'external'; a collection slug / CategoryId / listing id for
  // the other three.
  linkTarget: string;
  // Web only -- see bannerLink.ts. On the native app every external link
  // hands off to the device browser regardless of this flag, since there
  // is no in-app browser tab to open a "same tab" link into.
  openNewTab: boolean;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  isActive: boolean;
  createdAt: number;
}
