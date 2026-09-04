// The icon set is a closed union, so an attribute's card glyph is
// typechecked rather than being a free string that silently renders
// nothing. SettingsStore validates the database value against it on the
// way in -- see dbToCategoryAttribute.
import type { IconName } from '../icons/Icon';

// Category ids used to be a fixed union (electronics | vehicles | ...).
// Categories are now admin-managed rows in Supabase (myazar.categories),
// so any string is a valid id -- new categories the admin creates don't
// need a code change or redeploy to be usable everywhere a CategoryId
// used to be required.
export type CategoryId = string;

// The gate above the category tree -- Properties, Vehicles, Classifieds
// and (dormant) Jobs & Services. See DOMAINS.md for why this is a layer
// beside myazar.categories rather than a new root level inside it.
//
// A domain is a posting constraint and a browsing scope, not a category:
// listings never carry a domain of their own, it is derived from their
// category's top-level ancestor. That way the two can never disagree.
export interface ListingDomain {
  id: string;
  nameEn: string;
  nameAr: string;
  // Built-in icon name (src/icons/Icon.tsx), same convention as Category.
  icon: string;
  sortOrder: number;
  // Retires a domain outright. Separate from whether it currently has any
  // active categories -- a domain with none is simply not rendered, which
  // is what keeps Jobs & Services off the gate until it is switched on.
  active: boolean;
}

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
  // What `condition` means under this category -- see ConditionMode.
  // null means "inherit", and most rows are null: the nearest ancestor
  // (this row included) that names a mode wins, and nothing above the
  // whole tree means New/Used.
  //
  // Null rather than a defaulted 'new_used' so the setting works in both
  // directions. With the default doubling as "unset", a subcategory could
  // only ever narrow -- setting one back to New/Used under a Sale/rent
  // parent saved and then did nothing at all. This is what lets Pets hold
  // live animals (rehome) beside pet supplies (New/Used, because a
  // second-hand carrier really is one or the other) under one parent.
  //
  // Read it through conditionModeForCategory in SettingsStore, never off
  // the row, or a subcategory will answer for itself alone.
  conditionMode: ConditionMode | null;
  // Which attribute's value labels a listing card, instead of this
  // category's own name. Null -- the answer for nearly every category --
  // means the category name is the label.
  //
  // It exists for the two categories deliberately collapsed into ONE
  // postable leaf with their real kind moved into an attribute. Labelling
  // by category name there would print "Properties" over a Jounieh
  // apartment and "Vehicles" over a 2018 Civic, which tells a buyer
  // nothing the photo has not already told them; pointing this at
  // property_type gets "Apartment".
  //
  // Inherits nearest-ancestor-first, so it is read through
  // cardKindSlugForCategory in SettingsStore, never off the row.
  cardKindSlug: string | null;
  // Which attribute supplies the card's CONDITION badge. Null means the
  // universal `listings.condition` column is the badge, which is the normal
  // case and covers most of the catalogue.
  //
  // It exists because that column asks four different questions depending on
  // conditionMode, and two of them are not about condition at all. Vehicles
  // and Properties are `offer_type`, so their column holds sale/rent/both --
  // which the card deliberately does not print, because the price lines
  // already say it ("Buy for $22,000" beside a "For sale" pill is the same
  // sentence twice). Their real new-or-used answer sits in an attribute
  // instead: vehicle_condition on one, construction_status on the other. A
  // car with no New/Used on its card was the visible cost.
  //
  // Same shape and the same nearest-ancestor inheritance as cardKindSlug --
  // read through cardConditionSlugForCategory, never off the row.
  cardConditionSlug: string | null;
  // How many days a listing here stays active before it expires. Null
  // inherits from the nearest ancestor that names one, and 14 if none
  // does -- the same nullable-inherits shape as conditionMode, and for
  // the same reason: ninety-odd categories, of which about a dozen have
  // an answer that differs from their parent's. Read it through
  // lifetimeDaysForCategory in SettingsStore, never off the row.
  //
  // The DATABASE is authoritative: a BEFORE INSERT trigger sets
  // expires_at from this, and extend/republish go through RPCs that
  // resolve it server-side. This copy exists so the app can say "expires
  // in N days" without a round trip, not so it can decide anything.
  // See LIFECYCLE.md for why each value is what it is.
  listingLifetimeDays: number | null;
  // Which domain this category belongs to (see ListingDomain). Set on
  // top-level rows and inherited by their descendants, exactly as
  // isService and conditionMode are -- read it through
  // domainOfCategory in SettingsStore rather than off the row, or a
  // subcategory will answer null.
  domainId: string | null;
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

// What the `condition` field means on a category, resolved by walking up
// the tree (see SettingsStore's conditionModeForCategory). One value
// rather than a row of booleans that could contradict each other. This
// replaced a boolean that answered "is this Properties?" -- see AGENTS.md
// for the table and for why a fourth kind extends this rather than
// sitting beside it:
//   new_used   -- New / Used. The default, and most of the catalogue.
//   offer_type -- For sale / For rent / Both. Properties and Vehicles.
//   rehome     -- For sale / Free to a good home. Live animals, where
//                 New/Used is not a question anyone should be asked.
//   graded     -- New / Like new / Good / Fair. Second-hand fashion,
//                 where "Used" collapses a mint designer bag and a worn
//                 one into the same word and buyers filter on the
//                 difference before anything else.
//
// The values each mode offers, and the labels for them, live in ONE place
// -- src/lib/conditionModes.ts. They used to be re-typed as a nested
// ternary at every site that needed them (the create form, the batch
// review rows, the browse filter, the card badge, the whitelist that
// decides which values survive a round trip through the database), which
// is how 'free' shipped invisible: two of those lists were never updated
// and quietly dropped it on the way back out.
export type ConditionMode = 'new_used' | 'offer_type' | 'rehome' | 'graded';

// Why a listing could not be saved, in a form a screen can translate.
// 'refused' is the database declining the row -- an ungranted column, a
// failing CHECK, an RLS denial, a dropped connection. See AppStore's
// addListing, which used to swallow all of them.
// What a buyer is asked about a listing they made contact with, and what
// they can answer. The whole point is the phone case: Vevaty never sees
// that conversation, and the buyer is the only person who knows how it
// went. See LIFECYCLE.md.
export type ContactOutcome = 'available' | 'sold' | 'no_answer' | 'dismissed';

export type ContactPrompt = {
  listingId: string;
  titleEn: string | null;
  titleAr: string | null;
  photoUrl: string | null;
  // When they reached for the seller's number. Shown as "you contacted
  // this seller 2 days ago", because a bare question about a listing they
  // half-remember is a question they will dismiss.
  contactedAt: number;
};

export type ListingSaveErrorCode =
  | 'not-signed-in'
  | 'refused'
  // The write was accepted and changed nothing that matters, because a
  // database trigger quietly put the status back. enforce_listing_moderation_gate
  // does exactly this to a seller trying to publish something that has
  // never passed moderation: it rewrites new.status to old.status and
  // returns success, so there is no error to read and a row IS returned.
  // Distinguished from 'refused' because "try again" is the wrong advice
  // -- trying again does the same nothing, forever.
  | 'needs-review'
  // The edit would leave a listing that is ON THE SITE with no photos.
  // Refused rather than saved, because a live listing with nothing to
  // look at is the failure this whole area exists to prevent, and the
  // edit screen's own Save-and-exit path had no photo check of its own.
  // Distinguished from 'refused' because nothing was wrong with the
  // write -- the seller has to add a photo back, and no number of
  // retries will do it for them.
  | 'no-photos';

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
  // on the detail page), and in what order -- 1 is the first slot. Null
  // means "not on the card". Read through src/lib/cardSpecs.ts, which is
  // the only consumer.
  //
  // This column sat here unread for weeks while the card guessed instead
  // ("the required attributes, first two, in form order"). That guess was
  // actively wrong for Properties, whose required list starts with
  // property type and floor number -- so a card showed the floor and never
  // the bedrooms, bathrooms or area a buyer was actually scanning for.
  cardPriority: number | null;
  // Glyph shown beside this attribute's value on a listing card, chosen
  // per attribute in the admin rather than hardcoded per slug -- 157
  // attributes across ~90 categories is not a lookup table anyone can keep
  // honest. Null is a real answer, not a gap: the value renders with a
  // short text label instead ("Seats 5"), which is the right treatment for
  // anything self-describing. Only consulted when cardPriority is set.
  icon: IconName | null;
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
  // Field-level conditional visibility: this attribute only applies (is
  // rendered, required, and offered to/accepted from AI suggestion) when
  // another attribute on the same category, identified by slug, currently
  // holds one of these values. Both null together means always-visible --
  // the overwhelmingly common case. See resolveVisibleAttrs in
  // src/lib/attributeVisibility.ts for the one place this is interpreted.
  dependsOnSlug: string | null;
  dependsOnValues: string[] | null;
  // 'number' attributes only. False everywhere by default -- bedrooms,
  // areas and years have no meaningful negative value -- and true for the
  // few that do, currently just a property's floor, where -1 and -2 are
  // ordinary Beirut addresses rather than typos. As well as permitting the
  // value it decides which keyboard the field requests: iOS's plain
  // numeric keypad has no minus key, so without this the seller cannot
  // physically type one.
  allowNegative: boolean;
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
  // The listing's headline number, and the one every price consumer in
  // the app reads: the card, the detail hero, the Home/storefront price
  // filters, the price-drop collections, the related-listings sort. For a
  // listing that is for sale this is the sale price; for a rent-only
  // listing it is the rent value (mirrored from rentPrice below), so that
  // a rental never shows up priceless or sorts as $0. Never null -- the
  // column is NOT NULL in the database.
  price: number;
  // Rent pricing, for categories whose condition carries Sale/Rent/Both
  // -- Properties and Vehicles (see Category.conditionMode). Populated
  // whenever renting is offered at all -- condition 'rent' OR 'both' --
  // so "what does it rent for" always has one unambiguous home no matter
  // whether a sale price sits alongside it. All three are null for a
  // sale-only property and for every non-property listing.
  //
  // rentPeriod is what the rent value is quoted per, and it is not
  // cosmetic: $800/month and $800/year are a twelvefold difference, so
  // the create form requires an explicit pick rather than defaulting.
  // rentPaymentFrequency is how far ahead the tenant pays (month to
  // month, quarterly, every six months, or the full year up front) --
  // a real negotiating term in the Lebanese rental market, which is why
  // it sits with the rent value rather than among the category specs.
  rentPrice: number | null;
  rentPeriod: 'day' | 'week' | 'month' | 'year' | null;
  rentPaymentFrequency: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | null;
  // For most categories: whether the item is brand new or used, chosen by
  // the seller as a required pick on the very first step of the
  // create-listing wizard (see CreateListingScreen's category step). For
  // the Properties category this same first-step field instead captures
  // Sale/Rent/Both -- real estate has no meaningful New/Used distinction
  // (see ConditionPicker's genericized options prop), so 'sale'/'rent'/
  // 'both' reuse this one column and UI slot rather than adding a second.
  // Nullable only for the sake of listings posted before this field
  // existed -- see normalizeListing/dbListingToLocal's defensive-default
  // story for the same reasoning applied elsewhere on this type. A null
  // condition simply shows no badge on ListingCard rather than guessing.
  // 'new' is deliberately shared between new_used and graded rather than
  // given a graded twin: brand new is the same fact under either scale,
  // and two values meaning it would split every filter spanning both.
  condition: 'new' | 'used' | 'sale' | 'rent' | 'both' | 'free' | 'like_new' | 'good' | 'fair' | null;
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
  // The first gallery photo's small (~640px) card-thumbnail variant, if one
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
  // 'auction' is a lot held in an auction event -- see AUCTIONS.md. Such a
  // listing is NOT for sale in the ordinary sense: it has no fixed price,
  // no contact button, and must never reach a browse grid or a collection.
  // AppStore's fetch excludes it explicitly for that reason; the auction
  // surfaces read their lots through their own query.
  status: ListingStatus;
  // Bookkeeping for WHY status is what it is -- see the moderate-listing
  // edge function and AdminModerationScreen. 'pending' = AI check hasn't
  // resolved yet, 'flagged' = AI declined and it's waiting on a human.
  moderationStatus: 'pending' | 'ai_approved' | 'flagged' | 'human_approved' | 'rejected';
  // Set by a human moderator on rejection; shown to the seller so they know
  // what to fix before resubmitting. Null otherwise.
  moderationReason: string | null;
  // When this listing stops being visible. How long that is depends on
  // its CATEGORY -- 7 days for a phone, 45 for an apartment, 3 for a
  // ticket -- resolved nearest-ancestor-first and applied by the
  // database, never by a client: a trigger sets it on insert and
  // recomputes it if the category changes or the listing leaves draft,
  // and extend/republish go through RPCs that resolve the same function.
  // See LIFECYCLE.md for the numbers and the reasoning behind them.
  expiresAt: number;
  expiryReminderSentAt: number | null;
  // Set when buyers reported this listing as already sold and it was
  // hidden automatically -- see LIFECYCLE.md. Only ever non-null on a
  // 'draft', and it is what tells MyListings to explain why rather than
  // showing the ordinary "resume this draft" hint, and to offer restore.
  autoHiddenAt: number | null;
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
  // What this shop sells, as a domain -- the sell gate's own question,
  // answered once here instead of on every listing the merchant posts.
  // Null for a shop that has not answered it, which is what keeps the
  // gate showing for a merchant who genuinely sells across domains.
  //
  // Deliberately a stored setting rather than derived from
  // primaryCategoryId, even though every top-level category belongs to
  // exactly one domain: a merchant can say "Vehicles" without committing
  // to Cars or to Auto Parts. The two can never contradict each other
  // because the category chips are narrowed to the chosen domain (see
  // MyStorefrontScreen) -- the domain picks the categories, never the
  // other way round.
  domainId: string | null;
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
  // The domain chosen on the sell gate, constraining what the classifier
  // may return for every item in this batch. Held on the batch rather
  // than passed between screens: the batch flow spans six of them and can
  // be resumed later. Null for batches started before the gate existed --
  // those fall back to the unconstrained category list.
  domainId: string | null;
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
  // Hides the entire auction section -- the gate tile, the routes, the
  // admin entry point. Off by default in the database so a deploy can
  // never expose a half-assembled auction, and the one switch that has to
  // be thrown to demonstrate the feature. See AUCTIONS.md.
  auctionsEnabled: boolean;
}

// Every value listings.status can hold, as ONE list.
//
// It was written out by hand in three places -- the Listing type, the
// admin moderation filter, and AppStore's defensive whitelist -- and
// adding 'auction' to a subset of them is precisely the failure @AGENTS.md
// records for conditionModes: two of six copies were missed, and a listing
// saved as 'free' came back as null. The whitelist in particular coerces
// anything unrecognised to 'active', so a missed entry there does not
// throw, it silently mislabels an auction lot as a live listing.
export const LISTING_STATUSES = [
  'draft', 'active', 'sold', 'expired', 'removed',
  'pending_review', 'rejected', 'auction',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

// ---------------------------------------------------------------------
// Auctions. See AUCTIONS.md for the reasoning behind every rule below;
// this is only the shape.
// ---------------------------------------------------------------------

// An auction EVENT. Its status is stored rather than derived from the
// clock on purpose: an auction that should have opened but has not been
// advanced by the closer is a state worth being able to SEE, not one the
// UI quietly infers away.
export type AuctionStatus = 'draft' | 'scheduled' | 'live' | 'closed' | 'settled' | 'cancelled';

export interface Auction {
  id: string;
  titleEn: string;
  titleAr: string;
  status: AuctionStatus;
  opensAt: string | null;
  // When LOT ONE closes. Every later lot closes lotCloseStaggerSeconds
  // after the one before it.
  firstLotClosesAt: string | null;
  lotCloseStaggerSeconds: number;
  antiSnipeSeconds: number;
  sellerCommissionPct: number;
  buyerPremiumPct: number;
}

export type AuctionLotStatus =
  | 'pending' | 'live' | 'closed' | 'won' | 'unsold' | 'settled' | 'cancelled';

export interface AuctionLot {
  id: string;
  auctionId: string;
  // The lot's item is an ordinary Listing carrying status 'auction'.
  listingId: string;
  lotNumber: number;
  startPrice: number;
  // Whether a reserve EXISTS and whether it has been met are public; the
  // number itself never leaves the database, which is the convention every
  // auction house uses.
  hasReserve: boolean;
  reserveMet: boolean;
  // Null until the first bid. Not the leader's ceiling -- that is the
  // secret the whole mechanism rests on and no client ever sees it.
  currentPrice: number | null;
  bidCount: number;
  closesAt: string | null;
  status: AuctionLotStatus;
  winningAmount: number | null;
  // Whether the CURRENT viewer is the leading bidder. Resolved per viewer;
  // never the leader's identity.
  viewerIsLeading: boolean;
}

// One row of the public bid history. Deliberately narrow -- see
// myazar.auction_lot_bid_history: no max, no user id, no name. The alias
// is stable within one lot and unrelated across lots, which is enough to
// follow a duel and not enough to follow a person around the site.
export interface AuctionBidHistoryEntry {
  bidAt: string;
  amount: number;
  // Placed by the house as somebody's standing proxy rather than by a
  // person in the moment. Shown as such: implying a human acted would be a
  // lie about the one thing an auction has to be honest about.
  isAuto: boolean;
  bidderAlias: number;
  isMe: boolean;
}

// A saved card. Named SavedCard rather than PaymentMethod because that
// name is already taken by the payment-RAIL union above (whish /
// cash_confirmation / card) -- two different questions that would have
// been very easy to confuse at a call site.
//
// NO CARD NUMBER IS EVER STORED OR SENT. This is what a gateway hands back
// after tokenising on the client, and the demo provider produces the same
// shape from a published test number.
export interface SavedCard {
  id: string;
  provider: 'demo' | 'areeba' | 'tap' | 'paytabs';
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  status: 'active' | 'expired' | 'removed';
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
  // Which listing section this banner runs in, or null for all of them.
  // The rule is one line: a banner with a section shows only where the
  // section is known AND matches. So a Properties banner runs on the
  // Properties home and on a property's own listing page, and never in
  // the sidebar -- which belongs to no section and therefore shows only
  // banners that belong to none either.
  domainId: string | null;
  createdAt: number;
}
