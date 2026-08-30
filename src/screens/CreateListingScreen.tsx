import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, View, TextInput, ScrollView, Image, ActivityIndicator, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Alert } from '../lib/alertShim';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import PhotoGallery from '../components/PhotoGallery';
import DraggableList from '../components/DraggableList';
import CameraCapture from '../components/CameraCapture';
import SpinPreviewModal from '../components/SpinPreviewModal';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { RootStackParamList } from '../navigation/types';
import { AttributeValue, Category, CategoryId, ListingVariant, ListingVideo, SpinSet } from '../types';
import { attrHasValue, formatAttrValue } from '../lib/attributeFormat';
import { resolveVisibleAttrs } from '../lib/attributeVisibility';
import { buildDomainCandidates } from '../lib/domainCandidates';
import { domainIdFromSentinel } from '../lib/classifyPhotos';
import { RentPaymentFrequency, RentPeriod, rentPerPeriodLabelKey, requiresPaymentFrequency } from '../lib/rentTerms';
import RentTermsFields from '../components/RentTermsFields';
import { useLanguage } from '../i18n/LanguageContext';
import { translateListing } from '../lib/translate';
import { estimateListingPrice, AiSuggestSource, AiSuggestAttributeSchema } from '../lib/aiSuggest';
import { mirrorRow } from '../lib/mirrorRow';
import { LebanonPlace, findPlaceByExactName, findPlaceByFreeText, findPlaceById, nearestPlace } from '../data/lebanonPlaces';
import PlaceSuggestInput from '../components/PlaceSuggestInput';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import { useClassifyRun } from '../hooks/useClassifyRun';
import { useAiSpecSuggestion } from '../hooks/useAiSpecSuggestion';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import ActionSheet from '../components/ActionSheet';
import AiWorkingOverlay from '../components/AiWorkingOverlay';
import CategorySuggestInput from '../components/CategorySuggestInput';
import CategoryPickerModal from '../components/CategoryPickerModal';
import ConditionPicker from '../components/ConditionPicker';
import CategorySpecsForm from '../components/CategorySpecsForm';
import StockIntakeForm from '../components/StockIntakeForm';
import ShopChoiceGate from '../components/ShopChoiceGate';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  UploadHandle,
  createVideoUploadTicket,
  deleteVideo,
  fetchVideoStatus,
  measureVideoSeconds,
  nudgeVideoStatus,
  uploadVideoToBunny,
} from '../lib/bunnyVideo';
import LocationMapPicker from '../components/LocationMapPicker';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateListing'>;

type StepKind = 'classify' | 'photos' | 'verify' | 'spin' | 'specs' | 'stock' | 'details' | 'translate' | 'review';

// 360° spin capture frame count (Phase 3 item 7, raised from 8 to 12 after
// feedback that 8 (≥45°/frame) read as too choppy for bigger items like
// cars -- 12 frames is 30°/frame, the low end of standard commercial
// product-spin rigs, and reads as an actual smooth spin rather than a
// slideshow). Max 24 (15°/frame) caps upload size and seller tedium.
// How many photos a listing can carry in total. Was written out as a bare 6
// at each call site; named here because the in-camera batch has to know how
// many slots are left before it opens.
const PHOTOS_MAX = 6;
// Minimum gallery photos required before the AI identification pass runs
// at all, and before Continue unlocks on the Photos step -- see
// hasEnoughPhotosForAi below. One photo is often a blurry or badly-angled
// first shot; three gives the vision model enough of the item (and enough
// of a hedge against any single bad photo) to actually identify it, rather
// than firing on the first tap and guessing from a single so-so frame.
const PHOTOS_MIN_FOR_AI = 3;
const SPIN_MIN_FRAMES = 12;
const SPIN_MAX_FRAMES = 24;

// Quick-pick name suggestions for a spin set, shown as tappable chips in
// SpinPreviewModal alongside free typing -- e.g. a car seller doing
// separate exterior/interior spins, or a property seller doing one spin
// per room, shouldn't have to type the same handful of names from scratch
// every time. Empty for everything else; free text always still works
// regardless of category.
function spinLabelSuggestionsFor(isVehicle: boolean, isProperty: boolean, language: 'en' | 'ar'): string[] {
  if (isVehicle) {
    return language === 'ar'
      ? ['خارجي', 'داخلي', 'غرفة المحرك', 'الصندوق الخلفي']
      : ['Exterior', 'Interior', 'Engine bay', 'Trunk'];
  }
  if (isProperty) {
    return language === 'ar'
      ? ['غرفة المعيشة', 'المطبخ', 'غرفة النوم', 'الحمام', 'الشرفة']
      : ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony'];
  }
  return [];
}

export default function CreateListingScreen({ navigation, route }: Props) {
  const { addListing, updateListing, profile, listings, isVerified, authChecked, myShop } = useAppStore();
  const { categoryById, resolveAttributesForCategory, categoryMatches, usesOfferTypeCategory, domains, allDomains, domainOfCategory, allCategories, childrenOf } = useSettings();
  const { t, language, isRTL } = useLanguage();
  const editListingId = route.params && 'editListingId' in route.params ? route.params.editListingId : undefined;
  const editingListing = editListingId ? listings.find((l) => l.id === editListingId) : undefined;
  const isEditMode = !!editingListing;

  // Defense in depth: the "Sell an item" tab already redirects to Auth
  // when logged out (MainTabs.tsx), and the RLS "anonymous sessions
  // cannot create listings" policy is the real backstop -- this only
  // matters for someone deep-linking straight to /sell while anonymous.
  // Gated on authChecked too -- isVerified STARTS false on every fresh
  // page load (its default state, before AppStore's initial ensureSession()
  // round-trip resolves), so without this a verified seller deep-linking
  // or reloading straight into /sell was incorrectly bounced to the login
  // screen every single time, before their real session even had a chance
  // to load. See authChecked's doc comment in AppStore.tsx.
  useEffect(() => {
    if (authChecked && !isVerified) navigation.replace('Auth', { returnTo: 'CreateListing', returnToParams: route.params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isVerified]);

  const initialCategory: CategoryId | null = editingListing?.cat || route.params?.initialCategory || null;

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<CategoryId | null>(initialCategory);
  // New vs used -- or, on a category flagged usesOfferType (Properties
  // and Vehicles), Sale/Rent/Both instead, see ConditionPicker's
  // genericized options prop -- lives on the Classify step, alongside category confirmation
  // (see canNextByKind.classify and the 'classify' step's JSX below), not
  // its own step: it's a single pick, not enough of a decision to earn a
  // whole step the way photos/details do, and keeping it off the step
  // list means it needs no changes to stepKinds or the Android/web
  // back-navigation logic those rounds already got right.
  const [condition, setCondition] = useState<'new' | 'used' | 'sale' | 'rent' | 'both' | null>(editingListing?.condition ?? null);
  const [photos, setPhotos] = useState<string[]>(editingListing?.photos || []);
  // A listing can have more than one named 360° spin (e.g. "Exterior"/
  // "Interior" for a car, one per room for a property) -- see the SpinSet
  // type. `spinSets` holds the committed list; everything below it tracks
  // whatever spin is currently being captured/retaken/previewed, kept
  // separate so a Retake or a plain X-close never mutates the committed
  // list until the seller actually taps Continue in SpinPreviewModal.
  const [spinSets, setSpinSets] = useState<SpinSet[]>(editingListing?.spinSets || []);
  // Index into spinSets for the set currently being retaken/previewed, or
  // null while capturing a brand-new one not yet added to the list.
  const [activeSpinIndex, setActiveSpinIndex] = useState<number | null>(null);
  // The listing's one optional video. Deliberately held HERE, at the wizard
  // level, rather than inside the photos step: the whole point of the
  // feature is that the seller carries on to Details while the upload is
  // still running, and state owned by the step would be thrown away the
  // moment they did. `videoUploadRef` is the live tus upload, kept only so
  // Remove can actually stop it rather than leaving bytes in flight.
  // The Photos step's own camera session. Separate from the spin and Magic
  // ones so a seller can't end up with one modal's shots landing in another
  // modal's array.
  const [photoCameraVisible, setPhotoCameraVisible] = useState(false);
  const [video, setVideo] = useState<ListingVideo | null>(editingListing?.video || null);
  const [videoProgress, setVideoProgress] = useState<number>(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoUploadRef = useRef<UploadHandle | null>(null);
  const [draftSpinFrames, setDraftSpinFrames] = useState<string[]>([]);
  const [draftSpinLabel, setDraftSpinLabel] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  // Instant interactive preview (drag-to-rotate, via SpinViewer) shown right
  // after a spin capture finishes, so the seller can judge the actual
  // assembled result before moving on -- see SpinPreviewModal.
  const [spinPreviewOpen, setSpinPreviewOpen] = useState(false);
  const [attrValues, setAttrValues] = useState<Record<string, AttributeValue>>(editingListing?.attributes || {});
  // Stock/variants -- kept as its own state rather than folded into
  // attrValues, the same way price/title/district each get their own
  // state instead of living in a generic bag: the variant attribute's
  // "value" (the array of in-stock option values) is DERIVED from this,
  // computed once at submit time (see buildStock in post() below), never
  // something the seller edits directly or the AI suggestion fills in.
  // `variantStock` is per-option-value quantity text, keyed by the
  // variant attribute's option value (e.g. { s: '3', m: '0', l: '5' });
  // `plainStockQty` is the single quantity field shown instead when the
  // category is 'multiple' stock mode but defines no is_variant attribute
  // (e.g. a shop selling one kind of accessory with no size to track).
  const [variantStock, setVariantStock] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (editingListing?.variants || []).forEach((v) => {
      const val = Object.values(v.attributes)[0];
      if (typeof val === 'string') m[val] = String(v.stockQty);
    });
    return m;
  });
  const [plainStockQty, setPlainStockQty] = useState<string>(
    editingListing && !editingListing.variants ? String(editingListing.stockQty ?? '') : ''
  );
  // The seller writes title/description once, in whatever language the app
  // is currently set to -- that's the "source" language. The translate step
  // suggests the other language automatically instead of asking the seller
  // to write (and translate) both themselves.
  const targetLang: 'en' | 'ar' = language === 'ar' ? 'en' : 'ar';
  const initialSourceTitle = editingListing ? (language === 'ar' ? editingListing.titleAr : editingListing.titleEn) : '';
  const initialSourceDescription = editingListing ? (language === 'ar' ? editingListing.descriptionAr : editingListing.descriptionEn) : '';
  const initialTargetTitle = editingListing ? (language === 'ar' ? editingListing.titleEn : editingListing.titleAr) : '';
  const initialTargetDescription = editingListing ? (language === 'ar' ? editingListing.descriptionEn : editingListing.descriptionAr) : '';
  const [title, setTitle] = useState(initialSourceTitle);
  const [description, setDescription] = useState(initialSourceDescription);
  // Drives the description textarea's height so it grows to fit whatever's
  // typed or AI-filled instead of scrolling inside a fixed box -- see the
  // textarea's own onContentSizeChange below. Seeded at the same 100 the
  // box used to be fixed at, so a short/empty description looks exactly as
  // it always has; the style itself floors it back to 100 with Math.max
  // (content shrinking, e.g. deleting text, should never shrink the box
  // below that starting size).
  const [descriptionHeight, setDescriptionHeight] = useState(100);
  // Same auto-grow treatment, for the same reason, on the Translate step's
  // own description field (targetDescription) -- a separate piece of state
  // since the two textareas are never visible at the same time but do grow
  // independently of each other.
  const [targetDescriptionHeight, setTargetDescriptionHeight] = useState(100);
  const [targetTitle, setTargetTitle] = useState(initialTargetTitle);
  const [targetDescription, setTargetDescription] = useState(initialTargetDescription);
  const [translating, setTranslating] = useState(false);
  // Starts true when editing a listing that already has the other-language
  // text filled in, so we don't clobber it with a fresh auto-translate.
  const [translateAttempted, setTranslateAttempted] = useState(!!(initialTargetTitle || initialTargetDescription));
  const [translateErrorMsg, setTranslateErrorMsg] = useState<string | null>(null);
  const [price, setPrice] = useState(editingListing ? String(editingListing.price) : '');
  // Rent terms -- only ever shown, filled and saved for a Properties
  // listing whose Sale/Rent/Both pick includes renting (see
  // showRentFields below). Seeded from the listing being edited so a
  // rental reopened for editing comes back with its own terms rather
  // than blank.
  const [rentPrice, setRentPrice] = useState(
    editingListing?.rentPrice != null ? String(editingListing.rentPrice) : ''
  );
  const [rentPeriod, setRentPeriod] = useState<RentPeriod | null>(editingListing?.rentPeriod ?? null);
  const [rentPaymentFrequency, setRentPaymentFrequency] = useState<RentPaymentFrequency | null>(
    editingListing?.rentPaymentFrequency ?? null
  );
  // Blank on a new listing. This used to prefill from the seller's saved
  // profile district, on the theory that most people sell from where they
  // live -- but a prefilled location is one nobody re-reads, so the wrong
  // town rides along silently on every listing posted from somewhere else.
  // An empty field asks the question; a filled one answers it for you.
  const [district, setDistrict] = useState(editingListing?.district || '');
  // The town/village resolved from either the map pin or the location text
  // search -- carries governorate + caza + coordinates. Seeded when editing
  // by geonameId first (survives town-name spelling drift across dataset
  // refreshes), then an exact-name match, then the free-text resolver
  // against the old freeform `district` for listings posted before this
  // feature existed -- those hold text like "Achrafieh, Beirut", which is
  // an exact match for nothing and needs the free-text pass to resolve.
  const [resolvedPlace, setResolvedPlace] = useState<LebanonPlace | null>(() => {
    const seedText = editingListing?.district || '';
    return (
      findPlaceById(editingListing?.geonameId) ||
      findPlaceByExactName(seedText) ||
      findPlaceByFreeText(seedText)
    );
  });
  // Precise coordinates -- from the map pin, "Use my current location", or
  // a resolved place's centroid. Takes priority over deriving an
  // approximate point from resolvedPlace at submit time. null means
  // "nothing captured yet".
  const [preciseCoords, setPreciseCoords] = useState<{ lat: number; lng: number } | null>(
    editingListing?.lat != null && editingListing?.lng != null
      ? { lat: editingListing.lat, lng: editingListing.lng }
      : resolvedPlace
        ? { lat: resolvedPlace.lat, lng: resolvedPlace.lng }
        : null
  );
  const [locating, setLocating] = useState(false);

  // Whether preciseCoords represents a point the SELLER chose -- geolocated
  // themselves, or tapped/dragged on the map -- as opposed to one derived
  // from their town. Both end up in the same field and both are worth
  // saving, but only one of them is "your location", and the UI should not
  // claim otherwise: with the location text now resolving on open, the
  // form would otherwise greet a seller who has touched nothing with
  // "Location captured" and a pin labelled "Your location" sitting on the
  // centre of their town. On edit, a stored lat/lng came from a seller
  // doing exactly that, so it counts.
  const [coordsFromSeller, setCoordsFromSeller] = useState(
    editingListing?.lat != null && editingListing?.lng != null
  );

  // Shared by the map pin-drop, "Use my location", and the text search's
  // blur resolve -- keeps district/resolvedPlace/preciseCoords in sync from
  // whichever input the seller used. `coords` is optional since a
  // text-search tap-select already knows the place without a coordinate
  // round-trip.
  //
  // `keepTyped` is for the blur resolve specifically. Recognising that
  // "Achrafieh, Beirut" means El Achrafiye is useful; rewriting the
  // seller's field to read "El Achrafiye" because GeoNames happens to
  // store it under that spelling is not -- it overwrites what they wrote
  // with a less familiar name they never chose. So a blur resolve attaches
  // the caza/governorate and leaves the text alone; only an explicit tap
  // on a dropdown row (where the seller picked that exact label) replaces
  // it. It also leaves an already-captured pin alone, so resolving the
  // text doesn't drag a precisely-placed marker back to a town centroid.
  const resolvePlace = (
    place: LebanonPlace | null,
    coords?: { lat: number; lng: number },
    opts?: { keepTyped?: boolean }
  ) => {
    setResolvedPlace(place);
    // Explicit `coords` only ever come from the two seller-driven paths
    // (the map's onChange, and "Use my current location"); a place centroid
    // reached through `place` alone never does.
    if (coords) { setPreciseCoords(coords); setCoordsFromSeller(true); }
    else if (place && !(opts?.keepTyped && preciseCoords)) setPreciseCoords({ lat: place.lat, lng: place.lng });
    if (place && !opts?.keepTyped) setDistrict(place.name);
  };
  const [posting, setPosting] = useState(false);
  // Read by the beforeRemove listener below (registered inside a useEffect
  // whose deps deliberately don't include `posting` -- see that effect's
  // own comment), so a plain closure over the `posting` state would only
  // ever see whatever it was when the listener was last (re)created, not
  // its value when the event actually fires. Set imperatively inside
  // post() itself instead of derived from `posting` during render --
  // deriving it from render timing would race against post()'s own
  // `setPosting(false)` followed immediately (same tick, no intervening
  // render) by `navigation.replace/navigate`, which is exactly the
  // sequence that has to be caught. Same "read the current value through a
  // ref written at the moment that matters" pattern CameraCapture.tsx uses
  // for capturingRef/framesRef.
  const postingRef = useRef(false);
  const [usedDraft, setUsedDraft] = useState(false);
  // Local URIs only -- never merged into `photos`, never uploaded. See the
  // 'verify' step below: these are extraction-only (read once by the AI
  // spec suggestion, then discarded), not part of the public listing
  // gallery. Index-addressed to match cat.verificationShotListEn/Ar --
  // every index must hold a real URI before Continue unlocks (see
  // canNextByKind.verify below); this step is mandatory, not skippable,
  // per an explicit product decision after a seller nearly missed it
  // entirely on a small, easy-to-miss button.
  const [verificationPhotos, setVerificationPhotos] = useState<string[]>([]);
  const [verificationAttempted, setVerificationAttempted] = useState(false);
  // Which prompt in cat.verificationShotListEn/Ar (by index) the camera is
  // currently open for, or null when closed -- one shared CameraCapture
  // instance handles every prompt for this category, re-triggered per tap
  // (there are at most two, VIN + odometer, so a whole camera instance per
  // prompt would be wasteful).
  const [verificationCameraIndex, setVerificationCameraIndex] = useState<number | null>(null);
  const { suggesting, suggest: runAiSpecSuggestion } = useAiSpecSuggestion();
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSources, setAiSources] = useState<AiSuggestSource[]>([]);
  // What the AI told us it could NOT pin down. Shown to the seller above
  // the title, because the expensive failure here is not "the AI didn't
  // know" -- it's the seller publishing a confident-sounding listing that
  // quietly guessed at the model, the capacity, or which of two pictured
  // objects was actually for sale.
  const [aiUncertain, setAiUncertain] = useState<string[]>([]);
  // Price research resolves seconds after the copy does, and the seller is
  // editing the form the whole time. This counter is what stops a reply
  // from a suggestion they've already moved past (re-ran it, changed
  // category, typed their own price) landing in the field later and
  // overwriting them.
  const priceRunRef = useRef(0);
  // Mirrors `price` so the async price callback can tell whether the
  // seller has typed one, without closing over a stale render's value.
  // Assigned during render rather than in an effect: it only ever needs to
  // be as fresh as the last render, and the seller cannot type between
  // that render and this microtask without causing another one.
  const priceRef = useRef(price);
  priceRef.current = price;
  const [aiPriceFilled, setAiPriceFilled] = useState(false);
  // True once at least one blank category-attribute field has been filled
  // in by the AI suggestion (see applyAiSuggestion) -- drives a summary
  // notice on the Details step. Deliberately NOT shown from within the
  // Specs step's own render: the fill can complete after the seller has
  // already moved on to Details (specs-only categories wait for that step
  // before firing at all, see the auto-trigger effect below), so a notice
  // placed only in the Specs step's JSX would often never be seen.
  const [aiAttributesFilled, setAiAttributesFilled] = useState(false);
  // True when this seller has hit the edge function's daily suggestion
  // cap -- shown instead of the generic aiFallbackNotice so it doesn't
  // read as "something's broken".
  const [aiRateLimited, setAiRateLimited] = useState(false);
  // Phase 4 item 14 -- which contact CTAs show on this listing's detail
  // page. Defaults to 'both' (existing behavior) for new listings and for
  // any listing posted before this field existed.
  const [contactMethod, setContactMethod] = useState<'phone' | 'chat' | 'both'>(editingListing?.contactMethod || 'both');
  // Storefronts -- only offered at all once the seller has a VERIFIED shop
  // (an unverified one would just bounce off enforce_listing_shop_ownership
  // server-side); defaults to whatever this listing is already attached to
  // when editing, off otherwise. See the ListingInput doc comment in
  // AppStore.tsx for why the form only ever needs to send a shop id, never
  // a denormalized copy of the shop's own name/slug.
  const [attachToShop, setAttachToShop] = useState<boolean>(
    (!!editingListing?.shopId && editingListing.shopId === myShop?.id) ||
      // Seeded from SellHubScreen when it already asked ShopChoiceGate this
      // question upfront (see shopChoiceResolved's own initializer below) --
      // safe to read synchronously here since route.params exist at first
      // mount, unlike the myShop-derived branch above.
      !!route.params?.shopChoice?.attachToShop
  );
  // A verified storefront owner starting a brand-new listing (never an
  // edit -- editing an existing listing has its own established shop,
  // corrected via the toggle on the Details step below, not this
  // upfront gate) sees a one-time fork before the ordinary wizard even
  // starts: "standalone listing" or "into <shop>". This is a bigger call
  // than any other create-listing setting (it decides which flow's rules
  // -- and, once storefront-specific fields like variants/stock_qty exist,
  // which FORM -- the seller is about to fill out), so it gets its own
  // screen rather than living as a toggle buried mid-form where a seller
  // who wanted their storefront could easily miss it and publish standalone
  // by default.
  const shouldAskShopChoice = !isEditMode && !!myShop?.verifiedAt;
  // Deliberately NOT initialized from `!shouldAskShopChoice` -- myShop is
  // still null on the very first render of a fresh page load/deep link
  // (AppStore's shop fetch is async, same story as authChecked above), so
  // shouldAskShopChoice is always false at that instant even for a real
  // storefront owner. useState's initializer only runs once, at mount, so
  // seeding this from that not-yet-loaded value would freeze it at `true`
  // forever and the chooser would never show once myShop actually arrives.
  // Starting at `false` unconditionally is safe: for anyone shouldAskShopChoice
  // is false for (no shop, or editing), the early-return below is gated on
  // shouldAskShopChoice too, so this only ever matters once a real shop is
  // confirmed.
  //
  // The one exception: when SellHubScreen already asked ShopChoiceGate this
  // exact question upfront, it hands the answer down as route.params.shopChoice
  // (see attachToShop's initializer just above, which reads the same param).
  // Unlike myShop, route.params is present synchronously at first mount, so
  // seeding straight from it here is safe and skips a redundant second ask.
  const [shopChoiceResolved, setShopChoiceResolved] = useState<boolean>(
    !!route.params?.shopChoice
  );

  // --- Classify (AI category guess from photos) ---------------------------
  // Replaces the old "Magic Listing" side-path: every listing now starts
  // with photos, and this is what turns those photos into a category guess
  // right on the next step, rather than needing a seller to tap a separate
  // button first. See categoryResolved/showConfirmPill below for the full
  // state model this drives.
  //
  // Immutable per screen-visit: the AI's classify guess. Only used to
  // decide whether the confirm pill is shown, never re-read as "the
  // current AI opinion" -- see showConfirmPill below.
  const [aiCategoryId, setAiCategoryId] = useState<CategoryId | null>(null);
  // Permanent once true for this screen instance. Flips only inside
  // selectCategoryManually -- never from opening/closing the browse sheet
  // without picking. Seeded true when editing a listing that already has a
  // category, which is also what makes the classify auto-run effect below
  // skip entirely for an edit: there's nothing to re-guess.
  const [manuallyChosen, setManuallyChosen] = useState<boolean>(isEditMode && !!editingListing?.cat);
  // Set only by tapping the confirm pill.
  const [pillConfirmed, setPillConfirmed] = useState(false);
  // One-shot guard so the auto-run effect below fires the classify call at
  // most once per screen-visit, the same way autoSuggestSignature guards
  // applyAiSuggestion further down.
  const [classifyAttempted, setClassifyAttempted] = useState(false);
  // The Classify step's own typeahead query, and whether the "browse all
  // categories" modal is open. Kept as plain state here rather than inside
  // CategorySuggestInput/CategoryPickerModal themselves so a step change
  // doesn't need to reset anything -- both components are fully controlled.
  const [categoryQuery, setCategoryQuery] = useState('');
  const [browseModalOpen, setBrowseModalOpen] = useState(false);
  // True while `title` holds the plain item name the classifier produced
  // rather than something the seller wrote. The auto-suggestion below
  // refuses to run when there is already a title -- the point being not to
  // overwrite the seller's own words -- and a machine-written seed was
  // tripping that guard, so the classify path stopped one step short of
  // the research it exists to do: it filled in "eufy camera" and then sat
  // there until the seller found the AI button and pressed it themselves.
  const [titleIsMagicSeed, setTitleIsMagicSeed] = useState(false);

  // Leaf-only, parent-qualified category options for both the classify
  // call and CategorySuggestInput's typeahead -- one list, two consumers.
  // Leaves only: those are the only categories a listing can actually be
  // filed under, so offering "Vehicles" alongside "Cars for Sale" would
  // just let the model (or the seller's search) answer with something the
  // form can't accept.
  const leafCategories = useMemo(
    () => allCategories.filter((c) => c.active && childrenOf(c.id).length === 0),
    [allCategories, childrenOf]
  );

  // The domain the seller picked on the sell gate. Editing an existing
  // listing derives it from that listing's category instead -- the gate is
  // never shown again, and a category already answers the question.
  // Set when the classifier answers with a domain sentinel -- the photos
  // plainly belong somewhere else. Cleared by switching or by dismissing.
  const [mismatchDomainId, setMismatchDomainId] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(
    route.params?.domain ?? (editingListing ? domainOfCategory(editingListing.cat)?.id ?? null : null)
  );

  const activeDomain = domainId ? allDomains.find((d) => d.id === domainId) : undefined;

  // A domain can resolve to exactly one postable category -- Properties
  // does today. There is then genuinely nothing to classify: the candidate
  // list handed to the AI holds one real option, so its "guess" is the
  // only answer it could have given. Asking the seller to double-check
  // that, having just picked Properties on the gate themselves, is
  // ceremony over a decision with one outcome.
  //
  // Derived rather than hardcoded to Properties: Vehicles has four leaves
  // (a car, spare parts, accessories, a number plate) and its guess is
  // real, and Properties would stop being a special case the moment it
  // gained subcategories again.
  const soleCategory = useMemo(() => {
    if (!domainId) return null;
    const inDomain = leafCategories.filter((c) => domainOfCategory(c.id)?.id === domainId);
    return inDomain.length === 1 ? inDomain[0] : null;
  }, [domainId, leafCategories, domainOfCategory]);

  // Settle it silently. manuallyChosen is the honest flag here: the seller
  // DID choose this, on the gate -- so Continue unlocks and no confirm
  // pill is ever offered.
  useEffect(() => {
    if (!soleCategory || category === soleCategory.id) return;
    setCategory(soleCategory.id);
    setManuallyChosen(true);
    setAiCategoryId(null);
  }, [soleCategory, category]);
  const mismatchDomain = mismatchDomainId ? allDomains.find((d) => d.id === mismatchDomainId) : undefined;

  // Leaf-only, parent-qualified category options for both the classify
  // call and CategorySuggestInput's typeahead -- one list, two consumers.
  // Leaves only: those are the only categories a listing can actually be
  // filed under, so offering "Vehicles" alongside a postable leaf would
  // just let the model (or the seller's search) answer with something the
  // form can't accept.
  //
  // Narrowed to the chosen domain, with a sentinel per other domain so a
  // wrong pick can still be detected -- see buildDomainCandidates.
  const classifyCategoryOptions = useMemo(
    () => buildDomainCandidates(domainId, leafCategories, allDomains, categoryById, domainOfCategory, language),
    [domainId, leafCategories, allDomains, categoryById, domainOfCategory, language]
  );

  // The typeahead and browse modal must never offer a sentinel: it is a
  // message to the classifier, not a category anything can be filed under.
  const pickableCategoryOptions = useMemo(
    () => classifyCategoryOptions.filter((o) => !domainIdFromSentinel(o.id)),
    [classifyCategoryOptions]
  );

  // The actual vision call + classifying/classifyError state now lives in
  // useClassifyRun (src/hooks/useClassifyRun.ts), shared with each in-flight
  // batch item -- this wrapper just decides what a resolved guess DOES to
  // this screen's own state (fill category/title), the one part that's
  // still genuinely single-listing-specific.
  const { classifying, classifyError, run: runClassifyCore } = useClassifyRun(classifyCategoryOptions, language);
  const runClassify = async (source: string[]) => {
    const outcome = await runClassifyCore(source, t('createListing.classifyPhotoReadFailed'));
    if (!outcome.ok || !outcome.result) {
      // Either a hard error (surfaced via classifyError already) or an
      // explicit "I can't tell" from the qualifier -- the photos are
      // still worth keeping either way, the seller just picks the
      // category by hand (mandatory, no pill).
      return;
    }
    // The classifier is telling us the photos belong to a different
    // domain entirely (see buildDomainCandidates). Offer the switch rather
    // than filing the listing somewhere it does not belong -- and do not
    // touch the category, which would strand a sentinel id on the form.
    const suggestedDomain = domainIdFromSentinel(outcome.result.categoryId);
    if (suggestedDomain) {
      setMismatchDomainId(suggestedDomain);
      return;
    }
    // With one possible category the classify call is still worth making
    // -- it seeds the title and can still flag a domain mismatch above --
    // but its category answer carries no information, so it is not
    // presented as a guess to confirm.
    if (!soleCategory) {
      setAiCategoryId(outcome.result.categoryId);
      setCategory(outcome.result.categoryId);
    }
    // A plain name for the item, which the AI suggestion pass then uses as
    // its seed and rewrites into a proper listing title.
    if (outcome.result.itemName && !title.trim()) {
      setTitle(outcome.result.itemName);
      setTitleIsMagicSeed(true);
    }
  };

  // Single entry point for both the typeahead's onSelect and the browse
  // modal's onSelect -- any actual manual pick removes the confirm pill
  // permanently for this screen, regardless of what value was picked or
  // whether the pill had already been tapped (see showConfirmPill below).
  const selectCategoryManually = (id: CategoryId) => {
    setCategory(id);
    setManuallyChosen(true);
  };

  // Keeps whichever field has focus above the keyboard. See the hook for
  // why KeyboardAvoidingView alone left fields half-covered on Android.
  const { scrollRef, onScroll, onInputFocus, keyboardHeight } = useKeyboardAwareScroll();

  const cat = categoryById(category || '');
  const resolvedAttrs = useMemo(() => (category ? resolveAttributesForCategory(category) : []), [category, resolveAttributesForCategory]);
  // The one attribute (if any) this category uses to break stock into
  // variants -- see the isVariant field's own doc comment. Kept out of
  // specAttrs/hasSpecs below: it never shows as a normal spec field, only
  // in the dedicated Stock step.
  const variantAttr = useMemo(() => resolvedAttrs.find((a) => a.isVariant) || null, [resolvedAttrs]);
  // resolveVisibleAttrs additionally drops any attribute whose
  // dependsOnSlug/dependsOnValues isn't currently satisfied (e.g.
  // Bedrooms once Property Type = Land) -- see its own doc comment. This
  // is the single choke point: every downstream consumer of specAttrs
  // (spec lines, AI-suggestion schema, payload, required-field
  // validation, the review-step summary) already reads from this list.
  const specAttrs = useMemo(
    () => resolveVisibleAttrs(resolvedAttrs.filter((a) => !a.isVariant), attrValues, condition),
    [resolvedAttrs, attrValues, condition]
  );
  const hasSpecs = specAttrs.length > 0;
  // Category.stockMode -- see its own doc comment. 'unique' (everything
  // until this feature existed, and still the vast majority of
  // categories) never shows a Stock step at all.
  const hasStockStep = cat?.stockMode === 'multiple';
  // Whether there's at least one gallery photo -- the strongest signal the
  // AI vision suggestion (see applyAiSuggestion below) can work from. Kept
  // separate from hasEnoughPhotosForAi below: this one still means "there's
  // something to send the vision model" (used to build the photo payload
  // and to decide whether background-AI hints have anything to show), not
  // "enough to trust an identification from".
  const hasPhotoSignal = photos.length > 0;
  // The actual trigger for starting the AI identification pass, and for
  // unlocking Continue on the Photos step (see canNextByKind.photos below)
  // -- requires PHOTOS_MIN_FOR_AI photos rather than firing off a single
  // one, so the seller can't tap through before the AI has had a real shot
  // at recognising the item.
  const hasEnoughPhotosForAi = photos.length >= PHOTOS_MIN_FOR_AI;
  // Drives the Brand/Model suggestion fields below. Vehicles is now a
  // single postable category rather than a tree of kinds -- the kind is
  // the vehicle_type spec -- so in practice this is that one category.
  const isVehicleCategory = category ? categoryMatches(category, 'vehicles') : false;
  // Drives the spin-name quick-pick chips (Living room/Kitchen/...) below,
  // same idea as isVehicleCategory -- true for "Properties" and everything
  // under it.
  const isPropertyCategory = category ? categoryMatches(category, 'properties') : false;
  // Mirrors isPropertyCategory for the in-flight AI price callback to
  // read, so a category corrected to Properties mid-request still
  // suppresses the estimate. Assigned during render for the same reason
  // priceRef above is: it only ever needs to be as fresh as the last
  // render, and the seller cannot change category between that render
  // and the callback without causing another one.
  const isPropertyCategoryRef = useRef(isPropertyCategory);
  isPropertyCategoryRef.current = isPropertyCategory;
  const spinLabelSuggestions = spinLabelSuggestionsFor(isVehicleCategory, isPropertyCategory, language);
  // Whether this category's `condition` carries Sale/Rent/Both rather
  // than New/Used -- Properties and Vehicles today, read from a database
  // flag rather than a hardcoded list. Deliberately NOT the same
  // question as isPropertyCategory above, which still gates the AI price
  // skip: a car genuinely can be priced from comparable listings, an
  // apartment cannot.
  const usesOfferType = category ? usesOfferTypeCategory(category) : false;
  // The Classify step's condition picker doubles as Sale/Rent/Both for
  // Properties (see condition state's own doc comment) -- same control,
  // same required slot, a different option set and label depending on
  // whether the resolved category is Properties.
  const conditionOptions = useMemo(
    () =>
      usesOfferType
        ? [
            { value: 'sale', label: t('createListing.condition.sale') },
            { value: 'rent', label: t('createListing.condition.rent') },
            { value: 'both', label: t('createListing.condition.both') },
          ]
        : [
            { value: 'new', label: t('createListing.condition.new') },
            { value: 'used', label: t('createListing.condition.used') },
          ],
    [usesOfferType, t]
  );
  // What the Details step asks for money-wise. Something listed for rent
  // has no sale price to give, and one listed for sale has no rent terms
  // -- asking for both regardless is what made a rental read as though it
  // were being sold. A listing with no Sale/Rent/Both pick yet (an
  // unfinished draft reopened here) falls back to the plain price field
  // so the step is never blank, and every category without usesOfferType
  // keeps the single universal Price field exactly as before.
  const showRentFields = usesOfferType && (condition === 'rent' || condition === 'both');
  const showSalePriceField = !showRentFields || condition === 'both';
  // Only whatever is actually on screen is required. The period is not
  // optional and is deliberately not defaulted: $800 a month and $800 a
  // year are a twelvefold difference, and a wrong guess here misprices
  // the listing by more than any other field on the form could.
  const pricingValid =
    (!showSalePriceField || price.trim().length > 0) &&
    // Number(...) > 0, not just non-blank: a "0" or a pasted non-numeric
    // rent would otherwise post a live rental reading "$0 / month", which
    // every price filter then skips over. Matches the batch flow's own
    // long-standing price gate.
    (!showRentFields ||
      (Number(rentPrice) > 0 &&
        !!rentPeriod &&
        (!requiresPaymentFrequency(rentPeriod) || !!rentPaymentFrequency)));
  // A rent-only property mirrors its rent value into `price` (see
  // buildPayload), so a seller who switches from Rent to Sale or Both
  // would otherwise find the sale field already filled in with the
  // monthly rent -- an $800 asking price on an apartment, one tap away
  // from being posted. Clearing on that transition makes them name the
  // sale price deliberately; the field is required and shows empty-red,
  // so nothing is lost silently.
  const prevShowSalePriceRef = useRef(showSalePriceField);
  useEffect(() => {
    if (showSalePriceField && !prevShowSalePriceRef.current) setPrice('');
    prevShowSalePriceRef.current = showSalePriceField;
  }, [showSalePriceField]);
  // If the seller sets a New/Used value and then changes category across
  // the Properties boundary (or vice versa), the previous value no longer
  // belongs to either option set above -- it would sit on `condition`
  // matching none of the visible pills, yet still read as "set" to
  // canNextByKind.classify below. Clearing it keeps the picker and the
  // Continue gate in sync with whichever option set is currently shown.
  useEffect(() => {
    setCondition((prev) => {
      if (prev === null) return prev;
      const stillValid = usesOfferType
        ? prev === 'sale' || prev === 'rent' || prev === 'both'
        : prev === 'new' || prev === 'used';
      return stillValid ? prev : null;
    });
  }, [usesOfferType]);

  // True once category has an actual, trustworthy value behind it -- either
  // the seller picked it by hand, or they tapped the confirm pill on the
  // AI's guess. Gates both the auto-suggest effect below (see its own doc
  // comment) and canNextByKind.classify.
  const categoryResolved = !!category && (manuallyChosen || pillConfirmed);
  // Pill visibility never reads pillConfirmed -- only whether there's
  // still an unconfirmed AI guess standing. This is what makes "manually
  // reselect the same value the AI guessed" correctly NOT bring the pill
  // back: once manuallyChosen flips true, the pill is gone for good.
  const showConfirmPill = !!aiCategoryId && !manuallyChosen;
  // Editing a listing that has already cleared moderation at least once
  // (moderationStatus survives a Hide -> draft round-trip, unlike status
  // itself -- see hideListing in AppStore.tsx) means the seller already
  // captured this exact shot for this exact item; asking again on every
  // edit would just be friction with no new signal for the AI to read. A
  // listing still 'pending'/'rejected' has never actually cleared
  // moderation, so it keeps the verify step -- rejected in particular may
  // need a fresh shot if that was part of what got flagged.
  const editListingAlreadyVerified =
    isEditMode && (editingListing?.moderationStatus === 'ai_approved' || editingListing?.moderationStatus === 'human_approved');
  // True for the 15 categories seeded with verification-shot prompts (see
  // the migration -- most categories have none). Drives both whether the
  // new 'verify' step appears in stepKinds and the auto-suggest effect's
  // extra gate below (it must NOT fire before this step is reached, or the
  // whole point of the targeted photo is lost).
  const needsVerification = !editListingAlreadyVerified && (cat?.verificationShotListEn.length ?? 0) > 0;
  // Every prompt slot must hold a real captured/picked URI -- verifyRow's
  // camera and library-fallback paths both write into verificationPhotos
  // by index, so a `.filter(Boolean)` count against the prompt list length
  // is all "has this seller finished the verify step" needs. False (never
  // blocking) for every category without a verify step at all.
  const verificationComplete =
    !needsVerification || verificationPhotos.filter(Boolean).length >= (cat?.verificationShotListEn.length ?? 0);

  const stepKinds: StepKind[] = useMemo(
    () => [
      'photos',
      'classify',
      ...(needsVerification ? (['verify'] as const) : []),
      ...(cat?.supports3d ? (['spin'] as const) : []),
      ...(hasSpecs ? (['specs'] as const) : []),
      ...(hasStockStep ? (['stock'] as const) : []),
      'details',
      'translate',
      'review',
    ],
    [needsVerification, hasSpecs, cat?.supports3d, hasStockStep]
  );

  // Auto-runs the classifier once there's enough photos to work from --
  // deliberately NOT gated on currentKind, so it can start firing in the
  // background the moment the seller crosses the photo threshold on the
  // Photos step, before they've even tapped Continue onto Classify (same
  // early-start idea as applyAiSuggestion's own auto-run effect below).
  // Skips entirely once manuallyChosen is already true, which covers both
  // "seller picked a category by hand" and "editing an already-categorized
  // listing" (see manuallyChosen's own initializer above) with one check --
  // never re-classifies already-published photos, never risks the AI
  // silently changing an editor's category.
  useEffect(() => {
    if (!hasEnoughPhotosForAi || manuallyChosen || classifyAttempted || classifying) return;
    setClassifyAttempted(true);
    runClassify(photos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnoughPhotosForAi, manuallyChosen, classifyAttempted, classifying]);

  // Drives both the camera's own cap and the "you already have six" refusal.
  const photosRemaining = Math.max(0, PHOTOS_MAX - photos.length);

  const STEP_LABELS: Record<StepKind, string> = {
    // With one possible category the step no longer asks a category
    // question at all (see soleCategory) -- naming it "Category" would
    // label the screen after the one thing it does not contain.
    classify: soleCategory
      ? usesOfferType
        ? t('createListing.stepSaleOrRent')
        : t('createListing.stepCondition')
      : t('createListing.stepCategory'),
    photos: t('createListing.stepPhotos'),
    verify: t('createListing.stepVerify'),
    spin: t('createListing.stepSpin'),
    specs: t('createListing.stepSpecs'),
    stock: t('createListing.stepStock'),
    details: t('createListing.stepDetails'),
    translate: t('createListing.stepTranslate'),
    review: t('createListing.stepReview'),
  };
  const STEPS = stepKinds.map((k) => STEP_LABELS[k]);
  const currentKind = stepKinds[Math.min(step, stepKinds.length - 1)];

  const targetLangName = t(targetLang === 'ar' ? 'language.arabic' : 'language.english');

  const runTranslate = () => {
    if (!title.trim() && !description.trim()) return;
    setTranslating(true);
    setTranslateErrorMsg(null);
    translateListing(title.trim(), description.trim(), language).then(({ data, error }) => {
      setTranslating(false);
      if (data) {
        setTargetTitle(data.title);
        setTargetDescription(data.description);
      } else if (error) {
        setTranslateErrorMsg(error.message);
      }
    });
  };

  // Auto-fetch a translation the first time the seller reaches the
  // translate step, unless we already have one (e.g. editing a listing
  // that already has the other-language text filled in).
  React.useEffect(() => {
    if (currentKind !== 'translate' || translateAttempted) return;
    setTranslateAttempted(true);
    runTranslate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKind, translateAttempted]);

  // Shared multi-select-from-library flow, parameterized by which state
  // array to append into and a cap on the total count -- used both for the
  // normal Photos step (setPhotos, 6) and as the spin-capture step's
  // fallback when the guided camera is unavailable/denied (setSpinPhotos,
  // SPIN_MAX_FRAMES). Returns how many photos were actually added (0 if the
  // seller canceled the picker or permission was denied) so the spin
  // fallback can decide whether there's anything worth previewing.
  const pickPhotosInto = async (setter: React.Dispatch<React.SetStateAction<string[]>>, limit: number): Promise<number> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('createListing.photoPermTitle'), t('createListing.photoPermMessage'));
      return 0;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: limit,
    });
    if (!result.canceled) {
      setter((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, limit));
      return result.assets.length;
    }
    return 0;
  };

  // Fallback for one verification-shot prompt when the guided camera is
  // unavailable/denied -- unlike pickPhotosInto above, this REPLACES
  // whatever was at this prompt's slot (a retake, not an addition), so a
  // single-image picker rather than the multi-select one is the right tool
  // here.
  const pickVerificationPhotoFromLibrary = async (index: number) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('createListing.photoPermTitle'), t('createListing.photoPermMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.7,
      selectionLimit: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setVerificationPhotos((prev) => {
        const next = [...prev];
        next[index] = uri;
        return next;
      });
    }
  };

  // Records or picks ONE video and starts sending it to Bunny immediately.
  //
  // The length limit cannot be imposed while recording -- neither a phone
  // browser's capture attribute nor Android's system camera app accepts one
  // from us, and videoMaxDuration below is honoured on iOS but not
  // everywhere -- so it is checked here instead, after the file exists and
  // before a single byte is sent. Refusing in one sentence beats spending
  // ten minutes of somebody's mobile data and refusing afterwards.
  const addVideo = async (fromCamera: boolean) => {
    setVideoError(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('createListing.photoPermTitle'), t('createListing.photoPermMessage'));
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          videoMaxDuration: MAX_VIDEO_SECONDS,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsMultipleSelection: false,
          selectionLimit: 1,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    const seconds = await measureVideoSeconds(asset.uri, asset.duration ?? null);
    // A second of slack: a "60 second" recording routinely measures 60.2.
    if (seconds != null && seconds > MAX_VIDEO_SECONDS + 1) {
      setVideoError(t('createListing.videoTooLong', { max: MAX_VIDEO_SECONDS, secs: Math.round(seconds) }));
      return;
    }
    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_VIDEO_BYTES) {
      setVideoError(t('createListing.videoTooBig'));
      return;
    }

    try {
      setVideoProgress(0);
      const ticket = await createVideoUploadTicket({
        title: title.trim() || 'Vevaty listing video',
        // Passing the listing id on an edit is what lets the server delete
        // the video being replaced, instead of orphaning it on Bunny.
        listingId: editListingId ?? null,
      });
      const { promise, handle } = uploadVideoToBunny(asset.uri, ticket, {
        mimeType: asset.mimeType ?? null,
        title: title.trim() || 'Vevaty listing video',
        onProgress: (fraction) => setVideoProgress(fraction),
      });
      videoUploadRef.current = handle;
      setVideo({
        guid: ticket.videoId,
        status: 'uploading',
        durationS: seconds,
        width: asset.width ?? null,
        height: asset.height ?? null,
        // Not known until Bunny has finished encoding and told us which
        // renditions it actually made -- see the webhook.
        resolutions: null,
      });

      await promise;
      videoUploadRef.current = null;
      setVideoProgress(1);
      setVideo((v) => (v && v.guid === ticket.videoId ? { ...v, status: 'processing' } : v));
      // Don't wait for Bunny's callback to say encoding started -- ask.
      nudgeVideoStatus(ticket.videoId);
    } catch (e: any) {
      videoUploadRef.current = null;
      setVideo(null);
      setVideoProgress(0);
      setVideoError(e?.message || String(e));
    }
  };

  // Local-only, like every other field on this form -- the server side
  // (syncPhotoKind, in AppStore's updateListing) diffs the final `photos`
  // array against what's on Supabase and deletes any hosted row that's no
  // longer in it, but only once the seller actually saves. Nothing here
  // deletes eagerly, so backing out of an edit without saving leaves the
  // listing's real photos untouched -- unlike removeVideo below, which is
  // architected differently (see its own comment).
  const removePhoto = (uri: string) => setPhotos((prev) => prev.filter((p) => p !== uri));

  const removeVideo = async () => {
    const guid = video?.guid;
    videoUploadRef.current?.abort();
    videoUploadRef.current = null;
    setVideo(null);
    setVideoProgress(0);
    setVideoError(null);
    // Removes it from Bunny too, not just from this form -- otherwise every
    // video a seller changed their mind about is stored and billed forever.
    if (guid) deleteVideo(guid).catch(() => {});
  };

  // Opens the in-app camera for the Photos step so several shots can be taken
  // in one go. It used to hand off to expo-image-picker's single-shot camera,
  // which closes and returns to the form after every photo -- six photos meant
  // six round trips through the form. The same CameraView the spin and Magic
  // flows already use keeps the seller in the viewfinder, shows what they have
  // taken along the bottom, and only comes back when they tap Done.
  const openPhotoCamera = () => {
    if (photosRemaining <= 0) {
      Alert.alert(
        t('createListing.photoLimitTitle'),
        t('createListing.photoLimitMessage', { max: PHOTOS_MAX })
      );
      return;
    }
    setPhotoCameraVisible(true);
  };

  // Fallback default name for a spin set the seller never typed/picked a
  // label for -- "Spin 1", "Spin 2", ... in whatever position it ends up
  // at in the list (index is 0-based, so +1 for a human-friendly count).
  const defaultSpinLabel = (index: number) => t('createListing.spinSetDefaultName', { n: index + 1 });

  // Opens the camera fresh for a brand-new spin set -- nothing is added to
  // spinSets until the seller actually confirms it in SpinPreviewModal.
  const startNewSpin = () => {
    setActiveSpinIndex(null);
    setDraftSpinFrames([]);
    setDraftSpinLabel('');
    setCameraOpen(true);
  };

  // Reopens the camera to recapture an already-committed spin set, keeping
  // its current label pre-filled (a seller retaking blurry photos usually
  // isn't also renaming the spin).
  const retakeSpin = (index: number) => {
    setActiveSpinIndex(index);
    setDraftSpinFrames([]);
    setDraftSpinLabel(spinSets[index].label);
    setCameraOpen(true);
  };

  // Reopens the interactive preview for an already-committed spin set,
  // with no recapture -- just lets the seller look at it again or rename
  // it via SpinPreviewModal's label field.
  const previewSpin = (index: number) => {
    setActiveSpinIndex(index);
    setDraftSpinFrames(spinSets[index].frames);
    setDraftSpinLabel(spinSets[index].label);
    setSpinPreviewOpen(true);
  };

  const confirmRemoveSpin = (index: number) => {
    Alert.alert(t('createListing.spinRemoveConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('createListing.spinRemoveSet'),
        style: 'destructive',
        onPress: () => setSpinSets((prev) => prev.filter((_, i) => i !== index)),
      },
    ]);
  };

  // Already-entered category spec values as "Label: value" strings (e.g.
  // "Brand: Toyota", "Year: 2020") -- for categories with a Specs step
  // (hasSpecs), this is what lets the AI write a title/description without
  // the seller having to type anything into Details first.
  const buildSpecsLines = (): string[] =>
    specAttrs
      .filter((a) => attrHasValue(attrValues[a.slug]))
      .map((a) => `${language === 'ar' ? a.labelAr : a.labelEn}: ${formatAttrValue(a, attrValues[a.slug], language)}`);

  // Backstop, mirrors the edge function's own MAX_ATTRS -- keeps the
  // request small even for a category with an unusually long attribute
  // list; today's observed max is 19 (Cars for Sale).
  const AI_ATTRIBUTE_SUGGEST_MAX = 30;

  // The schema (not the value) of whichever category attributes the
  // seller left blank -- sent alongside the specs/photos so the same AI
  // call that writes the title/description can also propose values for
  // fields the seller hasn't filled in yet. Already-filled attributes are
  // deliberately excluded here (they're already represented in
  // buildSpecsLines() as confirmed ground truth).
  const buildAttributeSchemaForSuggestion = (): AiSuggestAttributeSchema[] =>
    specAttrs
      .filter((a) => !attrHasValue(attrValues[a.slug]))
      .slice(0, AI_ATTRIBUTE_SUGGEST_MAX)
      .map((a) => ({
        slug: a.slug,
        label: language === 'ar' ? a.labelAr : a.labelEn,
        type: a.type,
        options:
          a.type === 'select' || a.type === 'multiselect'
            ? a.options.map((o) => ({ value: o.value, label: language === 'ar' ? o.labelAr : o.labelEn }))
            : undefined,
        unit: (language === 'ar' ? a.unitAr : a.unitEn) || undefined,
        required: a.required,
      }));

  // Falls back to a short identifying seed built from the specs the seller
  // already filled in (brand/model/version/year if present, else just the
  // category name) when there's no typed title to work from yet.
  const buildSeedTitle = (): string => {
    const identifying = ['brand', 'model', 'version', 'year']
      .map((slug) => attrValues[slug])
      .filter((v) => attrHasValue(v))
      .map((v) => String(v));
    if (identifying.length > 0) return identifying.join(' ');
    return cat ? (language === 'ar' ? cat.nameAr : cat.nameEn) : '';
  };

  // Real AI suggestion: looks at the seller's own photos (like a Google
  // Lens-style "what is this and what condition is it in") and/or searches
  // the web for facts about the item, then writes a fresh title/
  // description from whatever it found (see ai-suggest-listing edge
  // function -- never copies manufacturer/retailer copy verbatim). For
  // categories with a Specs step, the specs the seller already entered are
  // sent as confirmed ground truth. Photos, when there are any, are the
  // strongest signal of all -- they let this run the moment there are
  // photos, even with zero specs and zero typed title (see the auto-
  // trigger effect below). `silent` suppresses the "type something first"
  // alert for that automatic call.
  const applyAiSuggestion = async (opts?: { silent?: boolean }) => {
    const specsLines = hasSpecs ? buildSpecsLines() : [];
    const seedTitle = title.trim() || buildSeedTitle();
    if (!seedTitle && !hasPhotoSignal) {
      if (!opts?.silent) Alert.alert(t('createListing.aiNeedsTitleTitle'), t('createListing.aiNeedsTitleMessage'));
      return;
    }
    setAiError(null);
    setAiPriceFilled(false);
    setAiAttributesFilled(false);
    setAiRateLimited(false);
    const categoryName = cat ? (language === 'ar' ? cat.nameAr : cat.nameEn) : '';
    // Verification shot(s) go first, ahead of the general gallery photos --
    // see useAiSpecSuggestion's own doc comment on why lead-photo order is
    // what makes this feature work (photosForVision gives the first
    // AI_LEAD_PHOTOS full text-legible fidelity). Empty for every category
    // without a verify step, so this is a no-op there.
    const photoUris = [...verificationPhotos.filter(Boolean), ...(hasPhotoSignal ? photos : [])];
    const attributeSchema = hasSpecs ? buildAttributeSchemaForSuggestion() : [];
    const outcome = await runAiSpecSuggestion({
      seedTitle,
      categoryName,
      language,
      specsLines,
      photoUris,
      attributeSchema,
      specAttrs,
      sellerId: profile.id,
    });
    if (outcome.ok) {
      const { result } = outcome;
      setTitle(result.title);
      setTitleIsMagicSeed(false);
      setDescription(result.description);
      setUsedDraft(true);
      setAiSources(result.sources);
      setAiUncertain(result.uncertain);
      // Price is researched separately and NOT awaited. The describe call
      // measures ~9s; adding price research to it took the whole thing to
      // 19-27s, because pricing needs three web searches to identification's
      // one and each search is a round trip the model waits on. The title
      // and description are on screen and editable by now, so the seller
      // reads and edits while this lands rather than watching a spinner
      // for a number they usually overwrite anyway.
      //
      // Skipped outright for Properties. Real estate is priced by
      // location, floor, view, finishing and the state of the building --
      // none of which a comparable-listings web search can read off a few
      // photos -- and the number it comes back with is confidently wrong
      // in a way that matters far more on a six-figure apartment than on
      // a used phone. Worse, it cannot know whether the seller is asking
      // a sale price or a monthly rent, which are three orders of
      // magnitude apart. The seller names their own number here.
      const run = ++priceRunRef.current;
      const pricePromise = isPropertyCategory
        ? Promise.resolve(null)
        : estimateListingPrice(result.title || seedTitle, categoryName, language, result.identification, specsLines);
      pricePromise
        .then((priced) => {
          if (!priced || run !== priceRunRef.current) return;
          // Re-checked on arrival, not just at call time: pricing takes
          // three web searches, and the seller can correct a wrong
          // category guess to Properties while it is still in flight.
          // The run counter alone doesn't catch that -- it only moves
          // when applyAiSuggestion re-runs, which a plain category change
          // doesn't trigger -- so without this an apartment could still
          // be handed a comparables price for whatever the AI first
          // thought it was.
          if (isPropertyCategoryRef.current) return;
          if (priced.priceRangeLow == null || priced.priceRangeHigh == null) return;
          // Fill only if still empty -- anything the seller typed while
          // this was researching is theirs and wins.
          if (!priceRef.current.trim()) {
            const mid = String(Math.round((priced.priceRangeLow + priced.priceRangeHigh) / 2));
            priceRef.current = mid;
            setPrice(mid);
            setAiPriceFilled(true);
          }
          if (priced.sources.length > 0) {
            setAiSources((prev) => {
              const seen = new Set(prev.map((x) => x.url));
              return [...prev, ...priced.sources.filter((x) => !seen.has(x.url))].slice(0, 3);
            });
          }
        })
        .catch(() => {
          // Best effort by design: no price is a field the seller fills
          // in, never an error over an otherwise complete listing.
        });
      // Fill in whatever blank attribute fields the AI could confidently
      // determine (already validated by the hook against each field's own
      // type/options) -- never overwrite anything the seller already set,
      // same fill-only-if-empty convention (reading current state via
      // closure, not a functional updater) as the price field above.
      if (Object.keys(result.attributes).length > 0) {
        const additions: Record<string, AttributeValue> = {};
        for (const a of specAttrs) {
          if (attrHasValue(attrValues[a.slug])) continue;
          const v = result.attributes[a.slug];
          if (v === undefined) continue;
          additions[a.slug] = v;
        }
        if (Object.keys(additions).length > 0) {
          setAttrValues((prev) => ({ ...prev, ...additions }));
          setAiAttributesFilled(true);
        }
      }
    } else {
      // Leave whatever the seller already typed alone -- they always have
      // at least a title at this point (guarded above), so silently
      // replacing it with the generic category template would be a worse
      // outcome than just surfacing the error and letting them retry or
      // keep writing it themselves.
      setAiSources([]);
      setAiUncertain([]);
      setAiError(outcome.error);
      setAiRateLimited(outcome.rateLimited);
    }
  };

  // Auto-run the AI suggestion as soon as there's signal to work from, and
  // no title yet (a fresh listing, not an edit of one that already has
  // text, and not a re-run after the seller already generated/typed
  // something). Photos are a complete signal only once category has
  // actually been resolved (see categoryResolved above) -- in the
  // photos-first order, Photos comes BEFORE Classify, so firing on photo
  // count alone would call this with an empty category name and produce a
  // wasted research pass. Gating on categoryResolved instead means the
  // research call can start firing the instant category is confirmed on
  // the Classify screen itself -- while the seller is still confirming
  // condition or has already moved on -- preserving the "already running
  // in the background" feel, just anchored to the right point in the new
  // sequence. Unlike specs, which are filled in field-by-field over the
  // whole Specs step, so a specs-only category (no photos at all) still
  // waits for the Details step, since specs are still being actively
  // filled in on their own step until then.
  // `autoSuggestSignature` records what we've already auto-run for, so:
  // once the threshold is crossed, adding more photos doesn't keep
  // re-firing (the vision call only looks at the first few anyway, see
  // AI_VISION_MAX_PHOTOS) -- one attempt per photo-signal is enough.
  //
  // The `!needsVerification || verificationAttempted` clause exists
  // entirely for the 'verify' step: without it, this effect (which fires
  // the instant categoryResolved flips true, mid-Classify-step) would run
  // the suggestion BEFORE the seller ever reaches the verify step, using
  // only the general gallery photos -- defeating the point of the targeted
  // shot. For every category without a verify step, needsVerification is
  // false and this clause is always true, so nothing changes there.
  const [autoSuggestSignature, setAutoSuggestSignature] = useState<string | null>(null);
  useEffect(() => {
    const readyToFire =
      (hasEnoughPhotosForAi && categoryResolved && (!needsVerification || verificationAttempted)) ||
      (hasSpecs && currentKind === 'details');
    if (!readyToFire || suggesting || (title.trim() && !titleIsMagicSeed)) return;
    const signature = hasEnoughPhotosForAi ? 'photos' : JSON.stringify({ attrValues });
    if (autoSuggestSignature === signature) return;
    setAutoSuggestSignature(signature);
    applyAiSuggestion({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentKind,
    hasSpecs,
    hasEnoughPhotosForAi,
    categoryResolved,
    needsVerification,
    verificationAttempted,
    title,
    suggesting,
    attrValues,
    autoSuggestSignature,
    titleIsMagicSeed,
  ]);

  // Turns off native-stack's own swipe-to-go-back gesture (and, on newer
  // Android versions/react-native-screens builds, the OS-level predictive-
  // back edge swipe) for this screen. Both are a SEPARATE dismissal path
  // from the classic hardware/software back button: they're recognised by
  // the native screen view itself and go straight to React Navigation's
  // own goBack() dispatch, never through RN's BackHandler
  // ('hardwareBackPress') event -- so the step-by-step handling just below
  // (which relies entirely on that event) never even sees them, and they
  // fall straight through to useUnsavedChangesGuard's beforeRemove
  // listener, which only knows "are there unsaved changes", not "which
  // step is the seller on". That's what made a swipe (or, on some
  // devices/OS versions, what reads to the seller as just "the back
  // button") mid-flow jump straight to the Save & exit / Exit without
  // saving prompt instead of stepping back once, the way every other
  // back-out path on this screen already correctly does. With the gesture
  // off, every dismissal attempt is forced through the on-screen back
  // arrow, the X, or the hardware back button -- all of which already run
  // through goBackOneStep/the BackHandler listener below and get the
  // per-step behaviour right.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  // Android's hardware back closed the entire create flow from any step,
  // dropping the seller on the home screen with everything they had
  // entered gone. On a seven-step form reached from a floating button,
  // back means "the previous step" -- that is what the on-screen arrow
  // does, and the hardware button is the same gesture by another route.
  //
  // Deliberately NOT `beforeRemove`, which would also intercept the web
  // build's browser-back and leave the URL pointing at /sell after we had
  // cancelled the navigation. This is the Android-only affordance, handled
  // where it lives.
  //
  // Scoped with useFocusEffect so the handler stops existing when the
  // screen is not on top -- otherwise it would keep swallowing back
  // presses from whatever screen was pushed above it. Modals in this flow
  // (Magic Listing, spin preview, confirm dialogs) all pass onRequestClose
  // and consume the press natively before it reaches here, so back closes
  // an open sheet first and only then walks the steps.
  const goBackOneStep = React.useCallback(() => {
    if (step === 0) {
      // A verified storefront owner backing out of the very first wizard
      // step lands back on the standalone-vs-storefront chooser rather
      // than exiting the whole flow -- they were just on that screen a
      // moment ago, and re-deciding shouldn't cost starting over. Gated
      // on shopChoiceResolved too: this component also renders the
      // chooser screen itself (the early return above), and back FROM
      // the chooser must exit like any other first screen, not loop back
      // into itself.
      if (shouldAskShopChoice && shopChoiceResolved) {
        setShopChoiceResolved(false);
        return;
      }
      navigation.goBack();
      return;
    }
    setStep((prev) => Math.max(0, prev - 1));
  }, [step, navigation, shouldAskShopChoice, shopChoiceResolved]);

  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // Same "return to the chooser, don't exit" reasoning as
        // goBackOneStep above -- and the same shopChoiceResolved gate, so
        // pressing back while the chooser itself is showing exits instead
        // of looping back into itself.
        if (step === 0) {
          if (shouldAskShopChoice && shopChoiceResolved) {
            setShopChoiceResolved(false);
            return true;
          }
          // Explicitly dispatch the same navigation.goBack() the on-screen
          // back arrow and the X both use at this point (see below), rather
          // than returning false and letting Android's default hardware-
          // back handling dismiss the modal on its own: on native, that
          // default path can complete the screen's removal at the
          // navigator level without ever going through React Navigation's
          // own goBack() action -- which is specifically what
          // useUnsavedChangesGuard's beforeRemove listener intercepts (see
          // that hook). Left as `return false` here, a seller who has
          // typed a title/price/photos and hits hardware back at the very
          // first step could lose the whole draft with no prompt at all,
          // instead of getting the same "Save & exit / Exit without
          // saving" choice every other way out of this screen already
          // gives them.
          navigation.goBack();
          return true;
        }
        setStep((prev) => Math.max(0, prev - 1));
        return true;
      });
      return () => sub.remove();
    }, [step, shouldAskShopChoice, shopChoiceResolved, navigation])
  );

  const setAttrValue = (slug: string, value: AttributeValue) => setAttrValues((prev) => ({ ...prev, [slug]: value }));
  const toggleMultiselectValue = (slug: string, optionValue: string) => {
    setAttrValues((prev) => {
      const current = Array.isArray(prev[slug]) ? (prev[slug] as string[]) : [];
      const next = current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue];
      return { ...prev, [slug]: next };
    });
  };

  const specsValid = !hasSpecs || specAttrs.every((a) => !a.required || attrHasValue(attrValues[a.slug]));
  // Either path counts: a resolved/typed town in the text field, or a
  // captured point from "Use my current location" -- see the "or" divider
  // in the Details JSX below, which is what makes these read as
  // alternatives rather than "fill in both". coordsFromSeller (not
  // preciseCoords) is what actually distinguishes "the seller geolocated
  // themselves" from a centroid silently derived from resolving the typed
  // text -- see its own doc comment above.
  const hasLocation = !!district.trim() || coordsFromSeller;

  const canNextByKind: Record<StepKind, boolean> = {
    // Category must actually be resolved (AI-confirmed via the pill, or
    // picked by hand -- see categoryResolved above) and condition set.
    classify: !!condition && categoryResolved,
    // Photos no longer gates on the AI research call at all -- that call
    // can't even start until category is resolved on the Classify step
    // right after this one (see categoryResolved/the auto-suggest effect
    // above), so the old "has the signature check fired yet" gate here
    // would just block Continue on something that structurally can't have
    // happened yet. Just the photo-count threshold.
    photos: hasEnoughPhotosForAi,
    // Mandatory: every verification-shot prompt for this category must
    // have a captured/picked photo before Continue unlocks (see
    // verificationComplete above). Was skippable ("worn VIN plate, an old
    // phone with no About screen") until a seller reported almost missing
    // the step entirely -- the library-fallback path inside CameraCapture
    // still covers a genuinely broken camera, so this doesn't strand
    // anyone, it just stops a silent skip.
    verify: verificationComplete,
    spin: true, // spin capture is optional even in supports3d categories, same as photos
    specs: specsValid,
    // Never blocks Next -- a shop can post with everything at 0 (e.g.
    // "coming soon"), same "optional, not a gate" treatment as photos/spin.
    stock: true,
    details: title.trim().length > 0 && pricingValid && hasLocation,
    // Was unconditionally true ("translation is a suggestion, never blocks
    // posting") -- but that let a seller tap through mid-translation and
    // post with the target-language fields still blank. Still non-blocking
    // once the translation call has actually resolved (successfully or
    // not); only held while it's in flight, same reasoning as photos above.
    translate: !translating,
    review: true,
  };
  const canNext = canNextByKind[currentKind];

  // expo-location -- works on both native (Android/iOS) and web (it wraps
  // the browser Geolocation API there), unlike the raw `navigator.geolocation`
  // call this used to make directly: that was web-only and silently broken
  // in the native build (no `navigator` global there), surfacing as a
  // confusing "This browser does not support location access" alert on a
  // real device. Reverse-resolves the captured coordinates against the same
  // dataset the map pin-drop uses, so "Use my location" also fills in the
  // town/district/governorate, not just raw coordinates like it used to.
  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access for this app to use your current location, or just leave the area field as text.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      resolvePlace(nearestPlace(coords), coords);
    } catch {
      Alert.alert('Could not get your location', 'Check your location permission for this app, or just leave the area field as text.');
    } finally {
      setLocating(false);
    }
  };

  // Bunny does not document whether it retries a failed webhook delivery,
  // so nothing here waits on one: while the seller is still in the wizard
  // this asks for the real state every few seconds. A missed callback should
  // mean a slightly later "ready", never a video stuck on "processing"
  // forever.
  useEffect(() => {
    if (video?.status !== 'processing') return;
    const guid = video.guid;
    let cancelled = false;
    const timer = setInterval(async () => {
      await nudgeVideoStatus(guid);
      const fresh = await fetchVideoStatus(guid);
      if (cancelled || !fresh || fresh.status === 'processing') return;
      setVideo(fresh);
    }, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [video?.guid, video?.status]);

  // Closing the tab mid-upload loses the upload. Web only -- there is no
  // equivalent event on the phone app, where backgrounding suspends rather
  // than kills, and tus resumes when the app comes back.
  useEffect(() => {
    if (Platform.OS !== 'web' || video?.status !== 'uploading') return;
    if (typeof window === 'undefined') return;
    const warn = (e: any) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [video?.status]);

  // Stock/variants -- computed once, here, from the Stock step's own
  // state (never from attrValues, see that state's doc comment above).
  // For a variant category, attributes[variantAttr.slug] is always
  // exactly the list of option values that ended up with stock > 0 --
  // the single fact that keeps every existing multiselect-based
  // filter/spec-display path (HomeScreen, StorefrontScreen, ListingCard,
  // formatAttrValue) working for it with zero special-casing.
  const buildStock = (): { stockQty: number; variants: ListingVariant[] | null; variantValues: string[] } => {
    if (!hasStockStep) return { stockQty: 1, variants: null, variantValues: [] };
    if (variantAttr) {
      const variants: ListingVariant[] = variantAttr.options
        .map((o) => ({ id: `v-${o.value}`, attributes: { [variantAttr.slug]: o.value }, stockQty: Number(variantStock[o.value]) || 0 }))
        .filter((v) => v.stockQty > 0);
      return {
        stockQty: variants.reduce((sum, v) => sum + v.stockQty, 0),
        variants,
        variantValues: variants.map((v) => v.attributes[variantAttr.slug]),
      };
    }
    return { stockQty: Number(plainStockQty) || 0, variants: null, variantValues: [] };
  };

  // Shared by the real Post/Save submit below and by saveAsDraftAndExit --
  // same payload shape either way, the only difference is the `status`
  // field draft saves add (see ListingInput's doc comment in AppStore.tsx).
  // Deliberately built from whatever is currently in the form with no
  // validation of its own: the wizard's own step gating (canNextByKind)
  // already guarantees a real submit can only be reached with everything
  // required filled in, while a draft save is allowed to carry blanks --
  // that's the whole point of a resumable draft.
  const buildPayload = (opts?: { asDraft?: boolean }) => {
    const attributes: Record<string, AttributeValue> = {};
    specAttrs.forEach((a) => {
      const v = attrValues[a.slug];
      if (attrHasValue(v)) attributes[a.slug] = v as AttributeValue;
    });
    const stock = buildStock();
    if (variantAttr && stock.variantValues.length > 0) {
      attributes[variantAttr.slug] = stock.variantValues;
    }
    const trimmedDistrict = district.trim() || 'Lebanon';
    const derivedCoords = preciseCoords || (resolvedPlace ? { lat: resolvedPlace.lat, lng: resolvedPlace.lng } : null);
    return {
      cat: category as CategoryId,
      // Guaranteed non-null on a real submit by canNextByKind.classify;
      // a draft save is allowed to carry it as null the same way it's
      // allowed to carry a blank title/price -- see this function's own
      // doc comment above.
      condition,
      titleEn: language === 'en' ? title.trim() : targetTitle.trim(),
      titleAr: language === 'ar' ? title.trim() : targetTitle.trim(),
      descriptionEn: language === 'en' ? description.trim() : targetDescription.trim(),
      descriptionAr: language === 'ar' ? description.trim() : targetDescription.trim(),
      // `price` is the headline number every price consumer in the app
      // reads (card, detail hero, filters, price-drop collections). For a
      // rent-only property there is no sale price to put there, so the
      // rent value stands in -- otherwise a rental would sort and filter
      // as $0 and show up priceless on its own card. See Listing.price.
      price: showSalePriceField ? Number(price) || 0 : Number(rentPrice) || 0,
      // Written whenever renting is offered at all, including the 'both'
      // case where a sale price occupies `price` -- so "what does it rent
      // for" always has one unambiguous home. Cleared to null the moment
      // the listing stops offering rent, so a seller who switches from
      // Rent to Sale never leaves stale terms behind.
      rentPrice: showRentFields ? Number(rentPrice) || 0 : null,
      rentPeriod: showRentFields ? rentPeriod : null,
      // Cleared for a day or week hire, where the term does not apply --
      // otherwise a seller who set it while on a monthly term and then
      // switched to daily would leave it behind, invisible and wrong.
      rentPaymentFrequency:
        showRentFields && requiresPaymentFrequency(rentPeriod) ? rentPaymentFrequency : null,
      district: trimmedDistrict,
      governorate: resolvedPlace?.governorate ?? null,
      caza: resolvedPlace?.caza ?? null,
      geonameId: resolvedPlace?.id ?? null,
      lat: derivedCoords?.lat ?? null,
      lng: derivedCoords?.lng ?? null,
      photos,
      spinSets,
      video,
      aiGenerated: usedDraft,
      attributes,
      contactMethod,
      shopId: attachToShop && myShop?.verifiedAt ? myShop.id : null,
      stockQty: stock.stockQty,
      variants: stock.variants,
      ...(opts?.asDraft ? { status: 'draft' as const } : {}),
    };
  };

  const post = async () => {
    if (!category) return;
    // Set before the state-driven `posting` even updates -- see
    // postingRef's own comment. This is what the beforeRemove listener
    // actually reads at navigation time; `posting` (the state) still
    // drives the button's loading spinner as before.
    postingRef.current = true;
    setPosting(true);
    const payload = buildPayload();
    if (isEditMode && editListingId) {
      await updateListing(editListingId, payload);
      setPosting(false);
      navigation.navigate('ListingDetail', { listingId: editListingId });
    } else {
      const listing = await addListing(payload);
      setPosting(false);
      navigation.replace('ListingDetail', { listingId: listing.id });
    }
    // The beforeRemove listener has already synchronously seen this
    // navigation by the time either call above returns (React Navigation
    // fires its events as part of the dispatch itself), so it's safe to
    // drop the guard back down now. Matters most for the edit-mode
    // `navigate` branch, which pushes ListingDetail on top rather than
    // replacing this screen -- CreateListingScreen stays mounted
    // underneath, and leaving this stuck `true` would silently disable its
    // own back/unsaved-changes guard for the rest of that instance's life.
    postingRef.current = false;
  };

  // The unsaved-changes guard (see useUnsavedChangesGuard) fires whenever
  // an exit is attempted while formSnapshot() differs from what it was at
  // mount. Tracks exactly the fields buildPayload above reads, plus `step`
  // (moving between steps with nothing else touched isn't a "change" worth
  // warning about, so it's deliberately excluded).
  const formSnapshot = () =>
    JSON.stringify({
      category,
      photos,
      spinSets,
      video,
      attrValues,
      // buildPayload reads this, and on a property it is what decides
      // which price columns get written at all -- so a seller who only
      // switches Both to Sale has made a real, saveable change and must
      // not be allowed to walk away from it unwarned.
      condition,
      price,
      rentPrice,
      rentPeriod,
      rentPaymentFrequency,
      district,
      title,
      description,
      targetTitle,
      targetDescription,
      contactMethod,
      attachToShop,
      plainStockQty,
      variantStock,
      resolvedPlaceId: resolvedPlace?.id ?? null,
      preciseCoords,
    });
  const baselineSnapshotRef = useRef(formSnapshot());
  const hasUnsavedChanges = !posting && formSnapshot() !== baselineSnapshotRef.current;

  // Set once this screen itself inserts a brand-new draft row (the first
  // "Save & exit" on a listing that didn't exist yet) so a second
  // "Save & exit" in the same session updates that row instead of inserting
  // a duplicate -- isEditMode/editListingId stay fixed to this screen's
  // original route params for its whole lifetime, so they alone wouldn't
  // notice the draft that was just created.
  const createdDraftIdRef = useRef<string | null>(null);

  const saveAsDraftAndExit = async (): Promise<boolean> => {
    // Nothing worth keeping yet (category is always the very first thing
    // picked, before anything else in the wizard can even be reached) --
    // let the exit proceed as if nothing needed saving.
    if (!category) return true;
    try {
      const payload = buildPayload({ asDraft: true });
      const targetId = editListingId || createdDraftIdRef.current;
      if (targetId) {
        await updateListing(targetId, payload);
      } else {
        const listing = await addListing(payload);
        createdDraftIdRef.current = listing.id;
      }
      return true;
    } catch {
      Alert.alert(t('unsavedChanges.saveFailedTitle'), t('unsavedChanges.saveFailedMessage'));
      return false;
    }
  };

  // A resumable draft is either a brand-new listing that was never
  // submitted, or an existing listing reopened while still in 'draft' --
  // both save via saveAsDraftAndExit above. Anything else being edited
  // (active, pending_review, expired, sold, rejected) is already a real
  // listing; "Save & exit" there just means "save my edits", the same
  // thing the Post/Save button at the Review step does, gated on the same
  // minimum fields that button's own step already required before it could
  // ever be reached.
  const isResumableDraft = !isEditMode || editingListing?.status === 'draft';
  const guardSaveAndExit = async (): Promise<boolean> => {
    if (isResumableDraft) return saveAsDraftAndExit();
    if (!category || !title.trim() || !pricingValid) {
      Alert.alert(t('unsavedChanges.cannotSaveTitle'), t('unsavedChanges.cannotSaveMessage'));
      return false;
    }
    try {
      await updateListing(editListingId as string, buildPayload());
      return true;
    } catch {
      Alert.alert(t('unsavedChanges.saveFailedTitle'), t('unsavedChanges.saveFailedMessage'));
      return false;
    }
  };

  const unsavedGuard = useUnsavedChangesGuard(hasUnsavedChanges, guardSaveAndExit);

  // The real cause of "back mid-wizard jumps straight to Save & exit /
  // Exit without saving instead of stepping back one step": on the WEB
  // build there is no BackHandler event at all (that's Android-only, see
  // the effect below) -- a browser back-button press is only ever visible
  // to this screen as a `beforeRemove` event, the exact same one
  // useUnsavedChangesGuard listens to just above. That hook only knows
  // "are there unsaved changes", not "which step is the seller on", so it
  // fires its own e.preventDefault() and opens the sheet regardless of
  // step. Confirmed with vevaty.com open in mobile Chrome: the previous
  // two fixes here were both Android-hardware-app-specific (BackHandler,
  // then disabling native-stack's swipe gesture) and never touched this
  // path at all, which is why the popup kept appearing after both of
  // them shipped.
  //
  // This listener is registered after the hook's own call above, so
  // (matching @react-navigation/core's plain-array, insertion-order event
  // dispatch) it normally runs second and its cancel() call undoes
  // whatever the hook's listener just did within the same synchronous
  // event. The setTimeout is the actual correctness guarantee though, not
  // that ordering: it defers cancel() to the next tick, after BOTH
  // listeners have already run no matter which fired first, so this stays
  // correct even if a future change to either hook reorders things. The
  // trade-off is a single-frame flash of the sheet before it closes back
  // out on browser back specifically (hardware back on native still goes
  // through BackHandler below first and never reaches this at all, so it
  // never flashes) -- accepted the same way this file already accepts a
  // brief URL-bar desync on browser back elsewhere (see
  // useUnsavedChangesGuard's own file-level comment), rather than left
  // showing the wrong prompt outright.
  useEffect(() => {
    const sub = (navigation as any).addListener('beforeRemove', (e: any) => {
      // `beforeRemove` doesn't only fire for the seller pressing back --
      // it's React Navigation's "this screen is about to leave the stack
      // by any means" event, and post()'s own `navigation.replace(...)` /
      // `navigation.navigate(...)` to ListingDetail on a successful post
      // triggers it too, since this screen is being removed to make room
      // for that one. Without this check, that removal was being caught
      // by the exact same logic meant for a real back-press: preventDefault()
      // cancelled the navigation to ListingDetail, and setStep(prev - 1)
      // then quietly stepped the wizard back one screen -- from Review
      // straight to Translate, since that's the step right before it --
      // so tapping Post/Save looked like it silently did nothing and
      // dumped the seller back on the translation screen. Bailing out
      // whenever a post/save is in flight (postingRef, see its own
      // comment for why a ref rather than the `posting` state directly)
      // leaves that navigation alone and only intercepts genuine back
      // attempts.
      if (postingRef.current) return;
      // Step 0 (including the shop-chooser sub-screen, which has its own
      // explicit back arrow) has nothing to step back to within this
      // screen -- let it fall through to the guard exactly as before.
      if (step === 0) return;
      // Cancel the navigation ourselves too, not just via the guard's own
      // preventDefault() below -- if there happen to be no unsaved changes
      // yet, the guard's listener returns early and never calls
      // preventDefault() at all, and without this the screen would
      // actually exit instead of stepping back.
      e.preventDefault();
      setStep((prev) => Math.max(0, prev - 1));
      setTimeout(() => unsavedGuard.cancel(), 0);
    });
    return sub;
  }, [step, navigation, unsavedGuard.cancel]);

  // Category-aware placeholders -- an admin can set an example title/
  // description per category (e.g. "3BR Apartment in Achrafieh") so the
  // seller sees something relevant instead of a generic phone example.
  // Falls back to the generic placeholder when the category has none set.
  const categoryTitlePlaceholder =
    (language === 'ar' ? cat?.titleExampleAr : cat?.titleExampleEn) || t('createListing.titlePlaceholder');
  const categoryDescriptionPlaceholder =
    (language === 'ar' ? cat?.descriptionExampleAr : cat?.descriptionExampleEn) || t('createListing.descriptionPlaceholder');

  // Small reassurance shown on the Photos/Spin/Specs steps (not just
  // Details) while the photo-triggered AI suggestion above is running or
  // has already finished -- since it now starts the instant a photo is
  // added rather than waiting for Details, sellers moving through the
  // earlier steps should see that it's already working for them instead
  // of it looking like nothing happened until they get there.
  const aiBackgroundNotice =
    hasPhotoSignal && (suggesting || (usedDraft && !!title.trim())) ? (
      <View style={styles.aiBackgroundNotice}>
        {suggesting ? (
          <ActivityIndicator size="small" color={colors.inkSoft} />
        ) : (
          <Icon name="sparkle" size={13} color={colors.inkSoft} />
        )}
        <Text style={[type.tiny, styles.aiBackgroundNoticeText]}>
          {suggesting ? t('createListing.aiResearchingHint') : t('createListing.aiDraftReadyHint')}
        </Text>
      </View>
    ) : null;

  if (shouldAskShopChoice && !shopChoiceResolved) {
    // src/components/ShopChoiceGate.tsx -- extracted so SellHubScreen can
    // show the exact same chooser once, upfront, for the batch-listings
    // flow. Reached directly (e.g. a deep link straight into CreateListing)
    // this renders byte-for-byte what it always has.
    return (
      <ShopChoiceGate
        onBack={() => navigation.goBack()}
        onChoose={(attach) => { setAttachToShop(attach); setShopChoiceResolved(true); }}
        title={t('createListing.shopChooserTitle')}
        storefrontTitle={t('createListing.shopChooserStorefrontTitle')}
        storefrontBody={t('createListing.shopChooserStorefrontBody', { name: myShop!.nameEn })}
        standaloneTitle={t('createListing.shopChooserStandaloneTitle')}
        standaloneBody={t('createListing.shopChooserStandaloneBody')}
      />
    );
  }

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={goBackOneStep} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{isEditMode ? t('createListing.editTitle') : STEPS[step]}</Text>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="close" size={18} />
        </Pressy>
      </View>

      <View style={styles.progressRow}>
        {STEPS.map((s, i) => (
          <View key={`${s}-${i}`} style={[styles.progressDot, i <= step && styles.progressDotActive]} />
        ))}
      </View>

      {/* KeyboardAvoidingView was not enough on its own here. It shrinks the
          scroll area, but shrinking is only half the job -- something still
          has to scroll the focused field up into what's left, and on
          Android nothing does (see useKeyboardAwareScroll). The result was
          a form that shifted a little and left the tapped field still half
          under the keyboard. The hook measures the field and scrolls by the
          exact overlap instead; the extra bottom padding below is what
          gives it room to scroll into. */}
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.scroll, { paddingBottom: SCROLL_BOTTOM_PAD + keyboardHeight }]}
        // Without this, the first tap on a suggestion row is swallowed by
        // the keyboard dismissal and never reaches the row -- the field
        // appeared to ignore the selection and snap back to the typed text.
        // 'handled' lets a tap that a child will handle through, while a
        // tap on empty space still dismisses the keyboard.
        keyboardShouldPersistTaps="handled"
      >
        {currentKind === 'classify' && (
          <View>
            {/* The blocking AiWorkingOverlay (rendered near the other
                overlays further down) covers the "please wait" state --
                this block only needs to handle the resolved states:
                error, AI-guess-with-pill, or empty-mandatory. */}
            {/* Which domain this listing is being posted into, and the way
                out. Shown whenever a domain is in force so a seller who
                tapped the wrong card on the gate can see it before they
                have filled anything in -- not only when the classifier
                happens to notice. */}
            {!!activeDomain && (
              <View style={styles.domainNotice}>
                <Text style={styles.domainNoticeText} numberOfLines={1}>
                  {t('createListing.postingInDomain', {
                    domain: language === 'ar' ? activeDomain.nameAr : activeDomain.nameEn,
                  })}
                </Text>
                {/* popTo, not replace or navigate: the hub this listing
                    was started from is still underneath, and both of those
                    would leave it there with its own params still saying
                    "skip" -- one back press and the merchant is bounced
                    into the domain they were trying to leave. popTo goes
                    back to that same hub and hands it chooseDomain, so
                    there is exactly one hub and it asks. (In React
                    Navigation 7 plain navigate no longer pops to an
                    existing route -- it pushes a second one.) */}
                <Pressy onPress={() => navigation.popTo('SellHub', { chooseDomain: true })}>
                  <Text style={styles.domainNoticeAction}>{t('createListing.postingInDomainChange')}</Text>
                </Pressy>
              </View>
            )}

            {/* The classifier said, from inside a closed in-domain list,
                that these photos belong to another domain -- see
                buildDomainCandidates. One tap switches and keeps the
                photos; the constraint is hard, not a trap. */}
            {!!mismatchDomain && (
              <View style={styles.mismatchBox}>
                <Text style={styles.mismatchText}>
                  {t('createListing.domainMismatch', {
                    domain: language === 'ar' ? mismatchDomain.nameAr : mismatchDomain.nameEn,
                  })}
                </Text>
                <View style={styles.mismatchActions}>
                  <Pressy
                    onPress={() => {
                      setDomainId(mismatchDomain.id);
                      setMismatchDomainId(null);
                    }}
                    style={styles.mismatchPrimary}
                  >
                    <Text style={styles.mismatchPrimaryText}>
                      {t('createListing.domainMismatchSwitch', {
                        domain: language === 'ar' ? mismatchDomain.nameAr : mismatchDomain.nameEn,
                      })}
                    </Text>
                  </Pressy>
                  <Pressy onPress={() => setMismatchDomainId(null)}>
                    <Text style={styles.mismatchDismiss}>{t('createListing.domainMismatchKeep')}</Text>
                  </Pressy>
                </View>
              </View>
            )}

            {/* Everything from here to the browse button is the "which
                category is this?" question. Skipped entirely when the
                domain has only one -- see soleCategory. What remains on
                the step is the domain line above and the Sale/Rent (or
                New/Used) pick below, which are real questions. */}
            {!soleCategory && (
              <>
            <Text style={styles.fieldLabel}>
              {t('createListing.categoryLabel')}
              <RequiredMark />
            </Text>

            {!!classifyError && !classifying && (
              <>
                <Text style={styles.aiErrorText}>{classifyError}</Text>
                <Pressy onPress={() => runClassify(photos)}>
                  <Text style={styles.retryLink}>{t('createListing.classifyRetry')}</Text>
                </Pressy>
              </>
            )}

            {!classifying && !classifyError && (
              <Text style={[type.soft, { marginBottom: 10 }]}>
                {category ? t('createListing.classifyAiGuessHint') : t('createListing.classifyNoGuessHint')}
              </Text>
            )}

            {/* The standalone "here's what's selected" pill still applies
                once the seller has manually picked a category (the search
                field's own typed text doesn't reliably mirror a browse-
                modal pick -- see selectCategoryManually) -- but NOT while
                there's an unconfirmed AI guess standing (showConfirmPill),
                since that case is now merged straight into the field
                itself via CategorySuggestInput's aiGuess prop just below,
                per the Classify-screen highlight redesign. */}
            {!!cat && !showConfirmPill && (
              <View style={fieldStyles.pillRow}>
                <View style={[fieldStyles.optPill, fieldStyles.optPillActive]}>
                  <Text style={[fieldStyles.optPillText, fieldStyles.optPillTextActive]}>
                    {language === 'ar' ? cat.nameAr : cat.nameEn}
                  </Text>
                </View>
              </View>
            )}

            <CategorySuggestInput
              query={categoryQuery}
              onChangeQuery={setCategoryQuery}
              options={pickableCategoryOptions.map((o) => ({ id: o.id, label: o.name, parent: o.parent }))}
              onSelect={(id) => selectCategoryManually(id as CategoryId)}
              placeholder={t('createListing.classifySearchPlaceholder')}
              aiGuess={showConfirmPill && cat ? { label: language === 'ar' ? cat.nameAr : cat.nameEn } : undefined}
              testID="classify-category-search"
            />

            {/* Confirm pill moved below the (now merged) field itself,
                small and right-aligned -- it's a lightweight acknowledgement
                of what the gold field above already shows, not a separate
                piece of information competing with it for attention. */}
            {showConfirmPill && (
              <Pressy
                onPress={() => setPillConfirmed(true)}
                style={[styles.draftBtn, styles.confirmPillSmall, pillConfirmed && styles.draftBtnDone]}
              >
                <Icon name="checkCircle" size={13} color={pillConfirmed ? colors.white : colors.ink} />
                <Text style={[styles.draftBtnText, pillConfirmed && styles.draftBtnTextDone]}>
                  {t('createListing.classifyConfirmPill')}
                </Text>
              </Pressy>
            )}

            <Pressy onPress={() => setBrowseModalOpen(true)} style={styles.browseCategoriesBtn}>
              <Icon name="grip" size={15} color={colors.ink} />
              <Text style={styles.browseCategoriesBtnText}>{t('createListing.classifyBrowseButton')}</Text>
            </Pressy>
              </>
            )}

            {/* New vs used (or, for Properties, Sale/Rent/Both -- see
                conditionOptions above) -- lives on this same screen, below
                classification (see canNextByKind.classify and the
                condition state's own doc comment above). ConditionPicker
                (src/components/ConditionPicker.tsx) is the same control
                the batch review screen's per-row fix path uses. */}
            <ConditionPicker
              value={condition}
              onChange={(v) => setCondition(v as typeof condition)}
              label={usesOfferType ? t('createListing.saleRentLabel') : t('createListing.conditionLabel')}
              options={conditionOptions}
            />
          </View>
        )}

        {currentKind === 'verify' && !!cat && (
          <View>
            <Text style={type.soft}>{t('createListing.verifyIntro')}</Text>
            {(language === 'ar' ? cat.verificationShotListAr : cat.verificationShotListEn).map((prompt, i) => {
              const captured = !!verificationPhotos[i];
              return (
                <View key={i} style={styles.verifyRow}>
                  <View style={styles.verifyRowText}>
                    <Text style={type.body}>{prompt}</Text>
                    {!captured && <Text style={styles.verifyRequiredTag}>{t('createListing.verifyRequired')}</Text>}
                  </View>
                  {captured ? (
                    <Image source={{ uri: verificationPhotos[i] }} style={styles.verifyThumb} />
                  ) : null}
                  <View style={styles.verifyShotBtnRow}>
                    {/* Its own dedicated style, not a reuse of draftBtn -- this
                        is the exact control the seller said they nearly missed,
                        so it needs to look like a first-class demand (large,
                        filled with the brand primary, a bold 22px icon) rather
                        than the same quiet pill draftBtn gives lesser actions
                        like the Classify confirm chip elsewhere on this screen. */}
                    <Pressy
                      onPress={() => setVerificationCameraIndex(i)}
                      style={[styles.verifyShotBtn, captured && styles.verifyShotBtnDone]}
                      accessibilityLabel={captured ? t('createListing.verifyRetake') : t('createListing.verifyTakePhoto')}
                    >
                      <Icon name={captured ? 'rotate' : 'camera'} size={22} color={captured ? colors.ink : colors.white} />
                      <Text style={[styles.verifyShotBtnText, captured && styles.verifyShotBtnTextDone]}>
                        {captured ? t('createListing.verifyRetake') : t('createListing.verifyTakePhoto')}
                      </Text>
                    </Pressy>
                    {/* Same picker pickVerificationPhotoFromLibrary already
                        used as CameraCapture's permission-denied fallback --
                        just surfaced here as a first-class, always-visible
                        choice instead of only appearing once the camera is
                        unavailable. A seller who already has the right photo
                        (an old screenshot of the About screen, a VIN shot
                        taken for insurance) shouldn't have to re-take it
                        through the camera just to move on. Always shown, even
                        after a shot is captured, so switching from a
                        camera-taken photo to a gallery one is one tap, not a
                        retake-then-cancel. */}
                    <Pressy
                      onPress={() => pickVerificationPhotoFromLibrary(i)}
                      style={styles.verifyGalleryBtn}
                      accessibilityLabel={t('createListing.addFromGallery')}
                    >
                      <Icon name="image" size={20} color={colors.inkSoft} />
                      <Text style={styles.verifyGalleryBtnText}>{t('createListing.addFromGallery')}</Text>
                    </Pressy>
                  </View>
                </View>
              );
            })}
            {!verificationComplete && (
              <Text style={styles.verifyBlockedHint}>{t('createListing.verifyRequiredHint')}</Text>
            )}
          </View>
        )}

        {currentKind === 'photos' && (
          <View>
            <Text style={type.soft}>{t('createListing.photosIntro')}</Text>
            {aiBackgroundNotice}
            <View style={styles.photoGrid}>
              {photos.map((uri) => (
                <View key={uri} style={styles.photoThumbWrap}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  <Pressy onPress={() => removePhoto(uri)} style={styles.photoRemoveBadge} accessibilityLabel={t('createListing.removePhoto')}>
                    <Icon name="close" size={12} color={colors.white} />
                  </Pressy>
                </View>
              ))}
              <Pressy onPress={openPhotoCamera} style={styles.addPhoto}>
                <Icon name="camera" size={20} color={colors.inkSoft} />
                <Text style={[type.tiny, styles.addPhotoLabel]}>{t('createListing.takePhoto')}</Text>
              </Pressy>
              <Pressy onPress={() => pickPhotosInto(setPhotos, PHOTOS_MAX)} style={styles.addPhoto}>
                <Icon name="image" size={20} color={colors.inkSoft} />
                <Text style={[type.tiny, styles.addPhotoLabel]}>{t('createListing.addFromGallery')}</Text>
              </Pressy>
            </View>

            {/* Shown until PHOTOS_MIN_FOR_AI photos are in -- this is the
                whole reason Continue stays disabled on this step (see
                canNextByKind.photos above), so the seller needs to see WHY,
                not just find the button greyed out. Uses the same
                warn-tint row as aiBackgroundNotice above, since both are
                "here's what's happening with the AI step" notices; this
                one just comes first. Clears itself the moment the
                threshold is crossed and aiBackgroundNotice's own
                "researching" state takes over instead. */}
            {photos.length < PHOTOS_MIN_FOR_AI && (
              <View style={styles.aiBackgroundNotice}>
                <Icon name="sparkle" size={13} color={colors.inkSoft} />
                <Text style={[type.tiny, styles.aiBackgroundNoticeText]}>
                  {t('createListing.photosMinRequiredHint', {
                    remaining: PHOTOS_MIN_FOR_AI - photos.length,
                    min: PHOTOS_MIN_FOR_AI,
                  })}
                </Text>
              </View>
            )}

            {/* Video sits on the photos step rather than getting a step of
                its own: one optional clip doesn't justify a whole extra
                screen every seller has to walk past. The upload runs from
                the wizard's own state, so Continue is never blocked by it. */}
            <View style={styles.videoBlock}>
              <Text style={styles.sectionLabel}>{t('createListing.videoLabel')}</Text>
              <Text style={type.soft}>{t('createListing.videoIntro', { max: MAX_VIDEO_SECONDS })}</Text>

              {!video && (
                <View style={styles.photoGrid}>
                  <Pressy onPress={() => addVideo(true)} style={styles.addPhoto}>
                    <Icon name="camera" size={20} color={colors.inkSoft} />
                    <Text style={[type.tiny, styles.addPhotoLabel]}>{t('createListing.videoRecord')}</Text>
                  </Pressy>
                  <Pressy onPress={() => addVideo(false)} style={styles.addPhoto}>
                    <Icon name="image" size={20} color={colors.inkSoft} />
                    <Text style={[type.tiny, styles.addPhotoLabel]}>{t('createListing.videoChoose')}</Text>
                  </Pressy>
                </View>
              )}

              {video && (
                <View style={styles.videoCard}>
                  <View style={styles.videoCardRow}>
                    <Icon
                      name={video.status === 'failed' ? 'close' : video.status === 'ready' ? 'checkCircle' : 'camera'}
                      size={15}
                      color={video.status === 'failed' ? colors.danger : video.status === 'ready' ? colors.success : colors.inkSoft}
                    />
                    <Text style={[type.soft, styles.videoStatusText]}>
                      {video.status === 'uploading'
                        ? t('createListing.videoUploading', { pct: Math.round(videoProgress * 100) })
                        : video.status === 'processing'
                          ? t('createListing.videoProcessing')
                          : video.status === 'ready'
                            ? t('createListing.videoReady')
                            : t('createListing.videoFailed')}
                    </Text>
                    <Pressy onPress={removeVideo} style={styles.videoRemoveBtn}>
                      <Icon name="trash" size={14} color={colors.inkSoft} />
                      <Text style={type.soft}>{t('createListing.videoRemove')}</Text>
                    </Pressy>
                  </View>
                  {video.status === 'uploading' && (
                    <View style={styles.videoProgressTrack}>
                      <View
                        style={[
                          styles.videoProgressFill,
                          // A plain conditional style, not the Animated API --
                          // see the standing note about Animated's web
                          // fallback dropping percentage widths.
                          { width: `${Math.max(2, Math.round(videoProgress * 100))}%` },
                        ]}
                      />
                    </View>
                  )}
                </View>
              )}

              {!!videoError && <Text style={styles.videoError}>{videoError}</Text>}
            </View>
            {/* The "good shots for X category" list used to live here, but
                `cat` is always null on this step now that Photos precedes
                Classify -- there's no category yet to tailor shot
                suggestions to. */}
          </View>
        )}

        {currentKind === 'spin' && (
          <View>
            <Text style={type.soft}>{t('createListing.spinIntro')}</Text>
            {aiBackgroundNotice}
            {spinSets.map((set, i) => (
              <View key={set.id} style={styles.spinSetCard}>
                <View style={styles.spinSetHeader}>
                  <Icon name="rotate" size={14} color={colors.inkSoft} />
                  <Text style={styles.spinSetLabel} numberOfLines={1}>
                    {set.label || defaultSpinLabel(i)}
                  </Text>
                  <Text style={type.tiny}>{t('createListing.spinFrameCount', { count: set.frames.length })}</Text>
                </View>
                <View style={styles.photoGrid}>
                  {set.frames.slice(0, 6).map((uri) => (
                    <Image key={uri} source={{ uri }} style={styles.photoThumb} />
                  ))}
                </View>
                <View style={styles.spinActionsRow}>
                  <Pressy onPress={() => previewSpin(i)} style={styles.spinRetakeBtn}>
                    <Icon name="expand" size={14} color={colors.inkSoft} />
                    <Text style={type.soft}>{t('createListing.spinPreviewOpen')}</Text>
                  </Pressy>
                  <Pressy onPress={() => retakeSpin(i)} style={styles.spinRetakeBtn}>
                    <Icon name="rotate" size={14} color={colors.inkSoft} />
                    <Text style={type.soft}>{t('createListing.spinRetake', { count: set.frames.length })}</Text>
                  </Pressy>
                  <Pressy onPress={() => confirmRemoveSpin(i)} style={styles.spinRetakeBtn}>
                    <Icon name="close" size={14} color={colors.inkSoft} />
                    <Text style={type.soft}>{t('createListing.spinRemoveSet')}</Text>
                  </Pressy>
                </View>
              </View>
            ))}
            <Pressy onPress={startNewSpin} style={styles.spinCaptureBtn}>
              <Icon name="rotate" size={20} color={colors.inkSoft} />
              <Text style={type.tiny}>
                {spinSets.length === 0 ? t('createListing.spinCaptureBtn') : t('createListing.spinAddAnother')}
              </Text>
            </Pressy>
          </View>
        )}

        {currentKind === 'specs' && (
          <View>
            <Text style={type.soft}>{t('createListing.specsIntro')}</Text>
            {/* No aiBackgroundNotice here (unlike Photos/Spin/Details, which
                still use it) -- the small inline pill let a seller start
                typing into a spec field while research was still running,
                only to have it filled out from under them once the AI call
                landed. The blocking AiWorkingOverlay below (see the other
                two further down) holds the whole step until `suggesting`
                resolves, same as Classify/Translate already do for the
                same reason. */}
            <CategorySpecsForm
              specAttrs={specAttrs}
              attrValues={attrValues}
              onSetValue={setAttrValue}
              onToggleMultiselect={toggleMultiselectValue}
              isVehicleCategory={isVehicleCategory}
              language={language}
              onFocus={onInputFocus}
              vehicleBrandModelPlaceholder={t('createListing.vehicleBrandModelPlaceholder')}
            />
          </View>
        )}

        {currentKind === 'stock' && (
          <View>
            <StockIntakeForm
              variantAttr={variantAttr}
              variantStock={variantStock}
              onChangeVariantStock={(optionValue, qty) => setVariantStock((prev) => ({ ...prev, [optionValue]: qty }))}
              plainStockQty={plainStockQty}
              onChangePlainStockQty={setPlainStockQty}
              language={language}
              onFocus={onInputFocus}
              variantIntro={
                variantAttr
                  ? t('createListing.stockVariantIntro', { label: language === 'ar' ? variantAttr.labelAr : variantAttr.labelEn })
                  : ''
              }
              plainIntro={t('createListing.stockPlainIntro')}
              stockQtyLabel={t('createListing.stockQtyLabel')}
            />
          </View>
        )}

        {currentKind === 'details' && (
          <View>
            {/* "How can buyers reach you?" leads the Details section --
                moved up from its old spot near the map so it's the first
                thing a seller decides here, before the AI-assisted fields
                below (see PHOTOS_MIN_FOR_AI/contact-method reasoning
                elsewhere in this step). */}
            <Text style={styles.fieldLabel}>{t('createListing.contactMethod')}</Text>
            <View style={fieldStyles.pillRow}>
              {(['both', 'chat', 'phone'] as const).map((m) => (
                <Pressy
                  key={m}
                  onPress={() => setContactMethod(m)}
                  style={[fieldStyles.optPill, contactMethod === m && fieldStyles.optPillActive]}
                >
                  <Text style={[fieldStyles.optPillText, contactMethod === m && fieldStyles.optPillTextActive]}>
                    {t(`createListing.contactMethod.${m}`)}
                  </Text>
                </Pressy>
              ))}
            </View>

            {(hasSpecs || hasPhotoSignal) && (
              <Text style={[type.soft, styles.detailsAutoIntro]}>{t('createListing.detailsAutoIntro')}</Text>
            )}
            <Pressy onPress={() => applyAiSuggestion()} style={styles.draftBtn} disabled={suggesting}>
              {suggesting ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Icon name="sparkle" size={15} color={colors.ink} />
              )}
              <Text style={styles.draftBtnText}>
                {suggesting ? t('createListing.aiSuggesting') : t('createListing.aiSuggestBtn')}
              </Text>
            </Pressy>
            {aiRateLimited ? (
              <Text style={styles.aiErrorText}>{t('createListing.aiRateLimitedNotice')}</Text>
            ) : (
              !!aiError && <Text style={styles.aiErrorText}>{t('createListing.aiFallbackNotice')}</Text>
            )}
            {aiUncertain.length > 0 && (
              <View style={styles.aiCheckBox}>
                <View style={[styles.aiCheckHead, mirrorRow(isRTL)]}>
                  <Icon name="sparkle" size={13} color={colors.accentDeep} />
                  <Text style={styles.aiCheckTitle}>{t('createListing.aiCheckTitle')}</Text>
                </View>
                {aiUncertain.map((u) => (
                  <Text key={u} style={styles.aiCheckItem}>{`\u2022 ${u}`}</Text>
                ))}
              </View>
            )}
            <Text style={styles.fieldLabel}>
              {t('createListing.title')}
              <RequiredMark />
            </Text>
            <TextInput
              onFocus={onInputFocus}
              value={title}
              onChangeText={(v) => { setTitle(v); setTitleIsMagicSeed(false); setUsedDraft(false); setAiSources([]); setAiUncertain([]); }}
              placeholder={categoryTitlePlaceholder}
              style={[styles.input, !title.trim() && styles.inputRequired]}
            />
            <Text style={styles.fieldLabel}>{t('createListing.description')}</Text>
            <TextInput
              onFocus={onInputFocus}
              value={description}
              onChangeText={(v) => { setDescription(v); setUsedDraft(false); setAiSources([]); setAiUncertain([]); }}
              // Grows the field to fit its content instead of scrolling
              // inside a fixed-height box -- contentSize.height is the
              // textarea's full intrinsic height (what it'd need to show
              // everything with no internal scroll at all), so mirroring
              // it onto the box itself is what makes the box match the
              // text rather than clip it. The style below floors this back
              // to 100 so short text still looks like the field always
              // has; there's deliberately no ceiling, since the whole
              // point is showing the entire AI-filled or typed description
              // without an inner scrollbar.
              onContentSizeChange={(e) => setDescriptionHeight(e.nativeEvent.contentSize.height)}
              placeholder={categoryDescriptionPlaceholder}
              multiline
              style={[styles.input, styles.textarea, { height: Math.max(100, descriptionHeight) }]}
            />
            {aiSources.length > 0 && (
              <View style={styles.aiSourcesBox}>
                <Text style={styles.aiSourcesLabel}>{t('createListing.aiSourcesLabel')}</Text>
                {aiSources.map((s) => (
                  <Pressy key={s.url} onPress={() => Linking.openURL(s.url)}>
                    <Text style={styles.aiSourceItem} numberOfLines={1}>{s.title}</Text>
                  </Pressy>
                ))}
              </View>
            )}
            {/* Sale price. Labelled "Sale price" rather than plain
                "Price" once the seller is on a property that offers a
                sale, so it reads unambiguously next to the rent value
                below in the Both case. */}
            {showSalePriceField && (
              <>
                <Text style={styles.fieldLabel}>
                  {usesOfferType && (condition === 'sale' || condition === 'both')
                    ? t('createListing.salePriceLabel')
                    : t('createListing.price')}
                  <RequiredMark />
                </Text>
                <TextInput
                  onFocus={onInputFocus}
                  value={price}
                  onChangeText={(v) => { setPrice(v); setAiPriceFilled(false); }}
                  placeholder="0"
                  keyboardType="numeric"
                  style={[styles.input, !price.trim() && styles.inputRequired]}
                />
                {aiPriceFilled && <Text style={styles.aiSourcesLabel}>{t('createListing.aiPriceFilledNotice')}</Text>}
              </>
            )}

            {/* Rent terms, Properties only -- shared with the batch
                flow's own details screen, see RentTermsFields. */}
            {showRentFields && (
              <RentTermsFields
                rentPrice={rentPrice}
                onChangeRentPrice={setRentPrice}
                rentPeriod={rentPeriod}
                onChangeRentPeriod={setRentPeriod}
                rentPaymentFrequency={rentPaymentFrequency}
                onChangeRentPaymentFrequency={setRentPaymentFrequency}
                onInputFocus={onInputFocus}
              />
            )}
            {aiAttributesFilled && <Text style={styles.aiSourcesLabel}>{t('createListing.aiAttributesFilledNotice')}</Text>}
            <Text style={styles.fieldLabel}>
              {t('createListing.location')}
              <RequiredMark />
            </Text>
            <PlaceSuggestInput
              style={hasLocation ? undefined : styles.inputRequired}
              onFocus={onInputFocus}
              value={district}
              onChangeText={(v) => {
                setDistrict(v);
                // Editing after a selection invalidates it -- mirrors the
                // old "editing Area clears preciseCoords" behavior. Stays
                // non-blocking: the typed text always saves verbatim even
                // if it never resolves to a known place.
                //
                // Compared through findPlaceByFreeText rather than against
                // the place's own name, because a blur resolve deliberately
                // leaves the seller's wording in place: with a plain name
                // comparison, "Achrafieh, Beirut" would resolve on blur and
                // then clear itself on the very next keystroke, since the
                // text never equals "El Achrafiye". Only text that no
                // longer points at the same place drops the resolution.
                if (resolvedPlace && findPlaceByFreeText(v)?.id !== resolvedPlace.id) {
                  setResolvedPlace(null);
                }
              }}
              onSelectPlace={(place) => resolvePlace(place)}
              onBlurResolve={(place) => { if (place) resolvePlace(place, undefined, { keepTyped: true }); }}
              placeholder={t('createListing.locationPlaceholder')}
            />
            {resolvedPlace ? (
              <Text style={styles.aiSourcesLabel}>
                {t('createListing.locationResolvedFormat', { caza: resolvedPlace.caza, governorate: resolvedPlace.governorate })}
              </Text>
            ) : (
              !!district.trim() && <Text style={styles.locationHint}>{t('createListing.locationUnresolvedHint')}</Text>
            )}
            {/* Two equally-valid ways to set location -- typing a town above,
                or geolocating below -- with the map underneath for either
                one to fine-tune by hand. The "or" divider is what makes the
                two methods read as alternatives rather than a stray button;
                location is now required (see hasLocation/canNextByKind
                above), so while neither path is satisfied yet the divider
                picks up the same danger tint as the fields around it --
                otherwise "or" reads as a throwaway label, not as the word
                that explains why filling in only one of the two is enough. */}
            <View style={styles.orDivider}>
              <View style={[styles.orDividerLine, !hasLocation && styles.orDividerLineRequired]} />
              <Text style={[styles.orDividerText, !hasLocation && styles.orDividerTextRequired]}>{t('common.or')}</Text>
              <View style={[styles.orDividerLine, !hasLocation && styles.orDividerLineRequired]} />
            </View>
            <Pressy
              onPress={useMyLocation}
              style={[styles.locationBtn, !hasLocation && styles.locationBtnRequired]}
              disabled={locating}
            >
              <Icon name="location" size={16} color={colors.ink} />
              <Text style={styles.locationBtnText}>
                {locating
                  ? t('common.loading')
                  : coordsFromSeller
                    ? t('createListing.locationCaptured')
                    : t('createListing.useMyLocation')}
              </Text>
            </Pressy>
            {/* Only shown when editing -- a fresh listing's shop attachment
                is decided upfront by the chooser screen (shouldAskShopChoice
                above), so this is purely the "I published standalone by
                mistake, or changed my mind" correction path the user asked
                for, not the primary way to attach a new listing. */}
            {isEditMode && !!myShop?.verifiedAt && (
              <>
                <Text style={styles.fieldLabel}>{t('createListing.storefrontLabel')}</Text>
                <View style={fieldStyles.pillRow}>
                  {([true, false] as const).map((opt) => (
                    <Pressy
                      key={String(opt)}
                      onPress={() => setAttachToShop(opt)}
                      style={[fieldStyles.optPill, attachToShop === opt && fieldStyles.optPillActive]}
                    >
                      <Text style={[fieldStyles.optPillText, attachToShop === opt && fieldStyles.optPillTextActive]}>
                        {opt ? t('createListing.storefrontYes', { name: myShop.nameEn }) : t('createListing.storefrontNo')}
                      </Text>
                    </Pressy>
                  ))}
                </View>
              </>
            )}

            {/* Map is the last detail on this page -- everything above it
                (contact method, title, description, price, location text/
                current-location) is either typed or a single tap, so the
                seller can move through them top to bottom without stopping;
                the map is the one control that takes real interaction
                (drag/zoom to fine-tune a pin), which reads better as a
                final "polish this before you're done" step than as
                something sitting in the middle of the form. */}
            <View style={styles.mapWrap}>
            <LocationMapPicker
              value={preciseCoords}
              onChange={(coords) => resolvePlace(nearestPlace(coords), coords)}
              hint={t('createListing.mapHint')}
              // Only label the pin when it stands for a point the seller
              // actually chose. Unlabelled it reads as a suggestion to
              // adjust, which is what a town centroid or an untouched
              // default is; labelled "Your location" it asserts a position
              // nobody set.
              pinLabel={coordsFromSeller ? t('createListing.mapPinLabel') : undefined}
            />
            </View>
            <Text style={styles.geonamesAttribution}>{t('createListing.geonamesAttribution')}</Text>
          </View>
        )}

        {currentKind === 'translate' && (
          <View>
            <Text style={type.soft}>{t('createListing.translateIntro', { lang: targetLangName })}</Text>

            {translating && (
              <View style={styles.translateLoadingRow}>
                <Icon name="sparkle" size={15} color={colors.inkSoft} />
                <Text style={type.soft}>{t('createListing.translateLoading', { lang: targetLangName })}</Text>
              </View>
            )}

            {!translating && translateErrorMsg && (
              <View style={styles.translateNotice}>
                <Text style={type.soft}>{t('createListing.translateUnavailable')}</Text>
                <Pressy onPress={runTranslate} style={styles.translateRetryBtn}>
                  <Text style={styles.translateRetryText}>{t('createListing.translateRetry')}</Text>
                </Pressy>
              </View>
            )}

            {!translating && (
              <>
                <Text style={styles.fieldLabel}>{t('createListing.translateTitleLabel', { lang: targetLangName })}</Text>
                <TextInput
                  onFocus={onInputFocus}
                  value={targetTitle}
                  onChangeText={setTargetTitle}
                  placeholder={t('createListing.translateTitlePlaceholder')}
                  style={[styles.input, targetLang === 'ar' && styles.rtlInput]}
                />
                <Text style={styles.fieldLabel}>{t('createListing.translateDescriptionLabel', { lang: targetLangName })}</Text>
                <TextInput
                  onFocus={onInputFocus}
                  value={targetDescription}
                  onChangeText={setTargetDescription}
                  // Same auto-grow as the Details step's description field
                  // -- see that field's own comment for why. The AI-
                  // translated text landing here is exactly the kind of
                  // longer, unpredictable-length content this exists for.
                  onContentSizeChange={(e) => setTargetDescriptionHeight(e.nativeEvent.contentSize.height)}
                  placeholder={t('createListing.translateDescriptionPlaceholder')}
                  multiline
                  style={[
                    styles.input,
                    styles.textarea,
                    { height: Math.max(100, targetDescriptionHeight) },
                    targetLang === 'ar' && styles.rtlInput,
                  ]}
                />
                {!translateErrorMsg && (
                  <Pressy onPress={runTranslate} style={styles.draftBtn}>
                    <Icon name="sparkle" size={15} color={colors.ink} />
                    <Text style={styles.draftBtnText}>{t('createListing.translateRetry')}</Text>
                  </Pressy>
                )}
              </>
            )}
          </View>
        )}

        {currentKind === 'review' && (
          <View>
            <View style={styles.reviewPhoto}>
              <PhotoGallery photos={photos} fallbackIconName={(cat?.icon as any) || 'bag'} />
            </View>
            {spinSets.length > 0 && (
              <View style={styles.spinReviewNote}>
                <Icon name="rotate" size={13} color={colors.inkSoft} />
                <Text style={type.soft}>
                  {t('createListing.spinReviewNote', {
                    sets: spinSets.length,
                    frames: spinSets.reduce((sum, s) => sum + s.frames.length, 0),
                  })}
                </Text>
              </View>
            )}

            {/* Reordering happens here, at the end of the wizard, rather than
                on the Photos step itself -- by the time a seller reaches
                Review they've actually seen every photo they ended up with
                (including any added later via Verify/AI), so this is the
                first point where "which one should lead?" is a real question
                rather than a guess. DraggableList (src/components/
                DraggableList.tsx) is the same dependency-free drag-to-reorder
                control the admin category-filters screen already uses -- no
                new library, and already proven on native + web. Dragging
                calls setPhotos directly, so the big preview above updates
                live, and since every place that persists `photos` (AppStore's
                addListing/updateListing) already writes sort_order from this
                array's plain index order, reordering here is the entire
                feature -- no separate save step, no backend change. Hidden
                entirely for a single photo, where "order" is meaningless. */}
            {photos.length > 1 && (
              <View style={styles.reorderSection}>
                <Text style={styles.sectionLabel}>{t('createListing.reorderPhotosTitle')}</Text>
                <Text style={[type.tiny, styles.reorderHint]}>{t('createListing.reorderPhotosHint')}</Text>
                <DraggableList
                  data={photos}
                  keyExtractor={(uri) => uri}
                  rowHeight={64}
                  onReorder={(orderedUris) => setPhotos(orderedUris)}
                  renderItem={(uri, index) => (
                    <View style={styles.reorderRow}>
                      <Image source={{ uri }} style={styles.reorderThumb} />
                      <Text style={type.body}>
                        {index === 0
                          ? t('createListing.reorderPhotosCover')
                          : t('createListing.reorderPhotosLabel', { n: index + 1 })}
                      </Text>
                    </View>
                  )}
                />
              </View>
            )}

            {/* Mirrors what the posted card will actually show: the sale
                price for a sale, the rent with its period for a rental,
                and both lines when the property is offered either way. */}
            {showSalePriceField && <Text style={styles.price}>${price || '0'}</Text>}
            {showRentFields && (
              <Text style={showSalePriceField ? styles.reviewRentLine : styles.price}>
                {rentPeriod
                  ? t(rentPerPeriodLabelKey(rentPeriod), { amount: rentPrice || '0' })
                  : `$${rentPrice || '0'}`}
              </Text>
            )}
            <Text style={[styles.title, isRTL && styles.rtlText]}>{title || t('createListing.untitled')}</Text>
            <Text style={[type.soft, { marginBottom: 8 }]}>{district || 'Lebanon'}</Text>
            <Text style={[type.body, isRTL && styles.rtlText]}>{description}</Text>
            {specAttrs.length > 0 && (
              <View style={styles.specsReview}>
                {specAttrs
                  .filter((a) => attrHasValue(attrValues[a.slug]))
                  .map((a) => (
                    <View key={a.id} style={[styles.specsReviewRow, isRTL && styles.specsReviewRowRTL]}>
                      <Text style={type.soft}>{language === 'ar' ? a.labelAr : a.labelEn}</Text>
                      <Text style={type.body}>{formatAttrValue(a, attrValues[a.slug], language)}</Text>
                    </View>
                  ))}
              </View>
            )}
            {hasStockStep && (
              <View style={styles.specsReview}>
                {variantAttr
                  ? Object.entries(variantStock)
                      .filter(([, q]) => Number(q) > 0)
                      .map(([val, q]) => {
                        const opt = variantAttr.options.find((o) => o.value === val);
                        const label = opt ? (language === 'ar' ? opt.labelAr : opt.labelEn) : val;
                        return (
                          <View key={val} style={[styles.specsReviewRow, isRTL && styles.specsReviewRowRTL]}>
                            <Text style={type.soft}>{label}</Text>
                            <Text style={type.body}>{t('createListing.stockQtyValue', { n: q })}</Text>
                          </View>
                        );
                      })
                  : (
                    <View style={[styles.specsReviewRow, isRTL && styles.specsReviewRowRTL]}>
                      <Text style={type.soft}>{t('createListing.stockQtyLabel')}</Text>
                      <Text style={type.body}>{plainStockQty || '0'}</Text>
                    </View>
                  )}
              </View>
            )}
            {usedDraft && (
              <View style={styles.aiTag}>
                <Icon name="sparkle" size={12} color={colors.ink} />
                <Text style={styles.aiTagText}>{t('createListing.aiDraftNotice')}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step < STEPS.length - 1 ? (
          <Button
            label={t('common.continue')}
            disabled={!canNext}
            onPress={() => {
              // Continue is only reachable here once every prompt is
              // captured (see canNextByKind.verify / verificationComplete),
              // so this is what unblocks the auto-suggest effect above
              // (see verificationAttempted/needsVerification) -- always
              // right after a genuinely complete verify step now, never a
              // skip.
              if (currentKind === 'verify') setVerificationAttempted(true);
              setStep((s) => s + 1);
            }}
          />
        ) : (
          <Button label={isEditMode ? t('createListing.saveChanges') : t('createListing.postListing')} loading={posting} onPress={post} />
        )}
      </View>

      <CameraCapture
        visible={cameraOpen}
        minFrames={SPIN_MIN_FRAMES}
        maxFrames={SPIN_MAX_FRAMES}
        onFinish={(frames) => {
          setDraftSpinFrames(frames);
          setCameraOpen(false);
          setSpinPreviewOpen(true);
        }}
        onCancel={() => setCameraOpen(false)}
        onFallbackToLibrary={async () => {
          setCameraOpen(false);
          const added = await pickPhotosInto(setDraftSpinFrames, SPIN_MAX_FRAMES);
          if (added > 0) setSpinPreviewOpen(true);
        }}
      />

      <CameraCapture
        visible={photoCameraVisible}
        // One photo is enough to be worth keeping, so Done unlocks
        // immediately; the cap is whatever is left of the six.
        minFrames={1}
        maxFrames={Math.max(1, photosRemaining)}
        instructions={t('createListing.photoCameraInstructions')}
        progressHint={(count) =>
          count === 0
            ? t('createListing.photoCameraStart', { max: photosRemaining })
            : t('createListing.photoCameraTaken', { count })
        }
        finishLabel={(count) => t('createListing.photoCameraDone', { count })}
        onFinish={(uris) => {
          setPhotoCameraVisible(false);
          if (uris.length === 0) return;
          setPhotos((prev) => [...prev, ...uris].slice(0, PHOTOS_MAX));
        }}
        onCancel={() => setPhotoCameraVisible(false)}
        onFallbackToLibrary={() => {
          setPhotoCameraVisible(false);
          pickPhotosInto(setPhotos, PHOTOS_MAX);
        }}
      />

      <CameraCapture
        visible={verificationCameraIndex !== null}
        // Exactly one shot per prompt -- a retake replaces it (see
        // pickVerificationPhotoFromLibrary), it never accumulates.
        minFrames={1}
        maxFrames={1}
        instructions={
          verificationCameraIndex !== null
            ? (language === 'ar' ? cat?.verificationShotListAr : cat?.verificationShotListEn)?.[verificationCameraIndex]
            : undefined
        }
        onFinish={(uris) => {
          const index = verificationCameraIndex;
          setVerificationCameraIndex(null);
          if (index === null || uris.length === 0) return;
          setVerificationPhotos((prev) => {
            const next = [...prev];
            next[index] = uris[0];
            return next;
          });
        }}
        onCancel={() => setVerificationCameraIndex(null)}
        onFallbackToLibrary={() => {
          const index = verificationCameraIndex;
          setVerificationCameraIndex(null);
          if (index !== null) pickVerificationPhotoFromLibrary(index);
        }}
      />

      <CategoryPickerModal
        visible={browseModalOpen}
        value={category}
        onSelect={(id) => selectCategoryManually(id)}
        onClose={() => setBrowseModalOpen(false)}
      />
      <SpinPreviewModal
        visible={spinPreviewOpen}
        frames={draftSpinFrames}
        label={draftSpinLabel}
        onChangeLabel={setDraftSpinLabel}
        labelSuggestions={spinLabelSuggestions}
        onRetake={() => {
          setSpinPreviewOpen(false);
          setDraftSpinFrames([]);
          setCameraOpen(true);
        }}
        onContinue={() => {
          const label = draftSpinLabel.trim() || defaultSpinLabel(activeSpinIndex ?? spinSets.length);
          setSpinSets((prev) => {
            if (activeSpinIndex != null) {
              const next = [...prev];
              next[activeSpinIndex] = { ...next[activeSpinIndex], label, frames: draftSpinFrames };
              return next;
            }
            return [...prev, { id: `spin-${Date.now()}-${prev.length}`, label, frames: draftSpinFrames }];
          });
          setSpinPreviewOpen(false);
          setActiveSpinIndex(null);
        }}
        onClose={() => {
          setSpinPreviewOpen(false);
          setActiveSpinIndex(null);
        }}
      />
      <ActionSheet
        visible={unsavedGuard.visible}
        title={t('unsavedChanges.title')}
        options={[
          { label: t('unsavedChanges.saveAndExit'), icon: 'check', onPress: unsavedGuard.saveAndExit },
          { label: t('unsavedChanges.exitWithoutSaving'), icon: 'close', destructive: true, onPress: unsavedGuard.exitWithoutSaving },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={unsavedGuard.cancel}
      />
      {/* Blocking "please wait" overlays -- see AiWorkingOverlay for why these
          exist alongside the small inline notices above (aiBackgroundNotice,
          translateLoadingRow): those are easy to tap straight past, these
          aren't. The classify overlay is scoped to `currentKind ===
          'classify'` -- classifying can become true while the seller is
          still on the Photos step (the auto-run effect isn't gated by
          currentKind, see its own doc comment above), and this overlay
          rendering unconditionally would otherwise silently block the
          Photos step's own Continue tap, which never depends on
          `classifying` at all (see canNextByKind.photos above). The old
          suggesting-on-photos overlay is gone entirely: applyAiSuggestion
          can no longer fire while on the Photos step now that it's gated
          on categoryResolved, which can't be true until at least the
          Classify step. */}
      <AiWorkingOverlay
        visible={classifying && currentKind === 'classify'}
        // With one possible category the call is still made -- it
        // seeds the title and can flag a domain mismatch -- but it is
        // not guessing a category, so it should not say it is.
        message={soleCategory ? t('createListing.classifyWorkingItem') : t('createListing.classifyWorking')}
      />
      <AiWorkingOverlay visible={translating} message={t('createListing.aiTranslateOverlay')} />
      {/* Same reasoning as the classify overlay above, applied to specs:
          `suggesting` (useAiSpecSuggestion) can already be true while the
          seller is still on Verify/Spin/an earlier step (see the auto-run
          effect's own doc comment -- specs research starts the instant
          categoryResolved flips true), so this is scoped to `currentKind
          === 'specs'` the same way, rather than blocking every step that
          happens to still be in flight when the seller reaches it. */}
      <AiWorkingOverlay visible={suggesting && currentKind === 'specs'} message={t('createListing.aiSpecsOverlay')} />
    </Screen>
  );
}

// A red asterisk for a required field's label -- shown next to Title and
// Price on the Details step (see the two TextInputs below) and next to
// every attribute.required spec field (see AttributeField below), so the
// seller can tell at a glance why Continue is disabled instead of hunting
// for whichever field they missed. Kept as its own component (a colored
// Text nested inside the label's own Text) rather than folding "*" into
// the label string, because fieldLabel's own style is a muted gray
// (type.tiny -- see inkSoft in theme.ts) and a plain "*" in that color
// barely reads as a required marker at all.
function RequiredMark() {
  return <Text style={styles.requiredMark}> *</Text>;
}

// AttributeField (the generic spec-field renderer) and its vehicle
// brand/model special case moved to src/components/CategorySpecsForm.tsx
// so the batch per-item Details screen can reuse them -- see that file's
// own doc comment. `fieldStyles` below is still shared by the Details/
// Location/Contact fields further down this file, so it stays here even
// though AttributeField itself moved out.

const fieldStyles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  // Layered onto `input` (or `pillRow`, for select/multiselect) only while
  // a required attribute is still empty -- see RequiredMark's doc comment
  // for why the label asterisk alone isn't enough. Clears itself the
  // moment the seller fills it in, so it reads as "still needs this", not
  // as a permanent warning. The tint matches AdminModerationScreen's
  // existing removed/rejected badge background (colors.danger's own light
  // tint isn't in the shared palette yet), so the app isn't carrying two
  // slightly different reds for the same "this needs attention" meaning.
  inputRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  pillRowRequired: {
    borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.sm,
    padding: 8, backgroundColor: '#f5e4e2',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  boolPill: {
    width: 44, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  boolPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  boolPillText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  boolPillTextActive: { color: colors.white },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optPill: {
    paddingHorizontal: 14, height: 38, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  optPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  optPillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  optPillTextActive: { color: colors.white },
  // The upfront "standalone or storefront?" chooser shown to a verified
  // storefront owner before the ordinary wizard starts (shouldAskShopChoice
  // above) -- two big equally-weighted cards rather than a pill pair, since
  // this is a bigger decision than any in-form toggle and deserves to read
  // that way.
  shopChooserWrap: { paddingHorizontal: 18, paddingTop: 20, gap: 14 },
  shopChooserCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, padding: 20,
  },
  shopChooserIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  shopChooserCardTitle: { fontSize: 16.5, fontWeight: '700', color: colors.ink, marginBottom: 5 },
  shopChooserCardBody: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  // Stock step -- one row per variant option (e.g. one per clothing
  // size), a plain label + a small quantity box rather than the
  // AttributeField/pill styling used for specs, since this reads more
  // like a small inventory sheet than a spec form.
  stockVariantList: { marginTop: 8, gap: 10 },
  stockVariantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stockVariantLabel: { fontSize: 14.5, color: colors.ink, flex: 1 },
  stockVariantInput: {
    width: 72, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, textAlign: 'center', fontSize: 14.5, color: colors.ink,
  },
});

// Bottom padding of the form when the keyboard is closed; the keyboard's
// height is added on top of it while it's open, so there is always room to
// scroll the focused field clear of it.
const SCROLL_BOTTOM_PAD = 20;

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  progressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 18, marginBottom: 14 },
  progressDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.line },
  progressDotActive: { backgroundColor: colors.primary },
  scroll: { paddingHorizontal: 18 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  photoThumbWrap: { width: 84, height: 84 },
  photoThumb: { width: 84, height: 84, borderRadius: radius.sm },
  photoRemoveBadge: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(20,20,22,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  addPhoto: {
    width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4,
  },
  addPhotoLabel: { textAlign: 'center' },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  videoBlock: { marginTop: 26 },
  videoCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    gap: 10,
  },
  videoCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  videoStatusText: { flex: 1 },
  videoRemoveBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  videoProgressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  videoProgressFill: { height: 5, borderRadius: 3, backgroundColor: colors.primary },
  videoError: { ...type.soft, color: colors.danger, marginTop: 10 },
  spinCaptureBtn: {
    marginTop: 14, height: 84, borderRadius: radius.sm, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  spinSetCard: {
    marginTop: 14, padding: 12, borderRadius: radius.sm,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  spinSetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spinSetLabel: { ...type.body, fontWeight: '600', flex: 1 },
  spinActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' },
  spinRetakeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12,
  },
  spinReviewNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12,
  },
  detailsAutoIntro: { marginBottom: 14 },
  aiBackgroundNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.warnBg, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 16,
  },
  aiBackgroundNoticeText: { ...type.tiny, textTransform: 'none', letterSpacing: 0, flex: 1, color: colors.inkSoft },
  draftBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 14, height: 36, marginBottom: 18,
  },
  draftBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  // Verify step: one row per verification-shot prompt (settings screen,
  // VIN plate, rating label...) -- prompt text on the left, a small
  // thumbnail once captured, and a large, dedicated take/retake button
  // (verifyShotBtn below, NOT draftBtn -- this step is mandatory and the
  // seller reported almost missing the button entirely, so it needs its
  // own bigger, bolder treatment rather than draftBtn's quiet pill, which
  // is shared with lesser actions like the Classify confirm chip).
  verifyRow: {
    gap: 10, marginBottom: 16, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  verifyRowText: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  verifyRequiredTag: {
    fontSize: 11, fontWeight: '700', color: colors.danger, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  verifyThumb: { width: 52, height: 52, borderRadius: radius.sm },
  verifyShotBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  verifyShotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 18, height: 56,
  },
  verifyShotBtnDone: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line },
  verifyShotBtnText: { fontSize: 16, fontWeight: '700', color: colors.white },
  verifyShotBtnTextDone: { color: colors.ink },
  // Secondary, always-available alternative to the take/retake button above
  // -- outlined rather than filled so the camera stays the visually primary
  // path (it's the one that guarantees a fresh, on-topic shot), while the
  // gallery option is still a real first-class tap, not buried in a
  // permission-denied fallback screen.
  verifyGalleryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line,
    borderRadius: radius.pill, paddingHorizontal: 16, height: 56,
  },
  verifyGalleryBtnText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  verifyBlockedHint: { ...type.tiny, color: colors.danger, marginTop: 4 },
  // The Classify step's confirm pill reuses draftBtn's shape but flips to
  // the primary/filled treatment once tapped, matching the checkCircle
  // icon it shows alongside -- a plain warn-tint pill read as "still
  // needs attention" even after confirming, which is backwards.
  draftBtnDone: { backgroundColor: colors.primary },
  draftBtnTextDone: { color: colors.white },
  // Classify step's confirm pill specifically -- overrides draftBtn's
  // default flex-start/full size to sit small and right-aligned just
  // under the (now gold, merged) category field it's confirming. See the
  // Classify-screen highlight redesign's own comment above its JSX.
  confirmPillSmall: { alignSelf: 'flex-end', height: 30, paddingHorizontal: 12, marginTop: 8, marginBottom: 12 },
  retryLink: {
    fontSize: 12.5, fontWeight: '600', color: colors.ink,
    textDecorationLine: 'underline', marginTop: -10, marginBottom: 16,
  },
  browseCategoriesBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 14, height: 36, marginTop: 10, marginBottom: 4,
  },
  browseCategoriesBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  aiErrorText: { fontSize: 12, color: colors.inkSoft, marginTop: -12, marginBottom: 16 },
  aiSourcesBox: { marginTop: -4, marginBottom: 16, gap: 3 },
  // Deliberately the accent tint rather than the danger colour: this is
  // "have a look at this", not "you did something wrong". It sits above
  // the title field so it is read before the copy it is warning about.
  aiCheckBox: {
    backgroundColor: colors.warnBg,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: -4,
    marginBottom: 16,
    gap: 4,
  },
  aiCheckHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  aiCheckTitle: { fontSize: 12.5, fontWeight: '700', color: colors.accentInk },
  aiCheckItem: { fontSize: 12.5, color: colors.accentInk, lineHeight: 18 },
  aiSourcesLabel: { ...type.tiny, textTransform: 'none', letterSpacing: 0, marginTop: 6 },
  aiSourceItem: { fontSize: 12, color: colors.ink, textDecorationLine: 'underline', marginTop: 2 },
  domainNotice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: colors.primaryTint, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12,
  },
  domainNoticeText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  domainNoticeAction: { fontSize: 13, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  // Gold rather than red: the seller has not done anything wrong, the
  // classifier is offering a shortcut.
  mismatchBox: {
    backgroundColor: '#fdf4e3', borderWidth: 1, borderColor: colors.accent,
    borderRadius: radius.sm, padding: 12, marginBottom: 12, gap: 10,
  },
  mismatchText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  mismatchActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  mismatchPrimary: {
    paddingHorizontal: 14, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  mismatchPrimaryText: { fontSize: 13, fontWeight: '700', color: colors.white },
  mismatchDismiss: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
  // The rent line on the review preview when a sale price is already
  // occupying the big number above it -- secondary, not competing.
  reviewRentLine: { fontSize: 15, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  // Deliberately styled like a real button (border, fill, centered) rather
  // than the old plain-text link -- it's an equally-valid alternative to
  // typing a town above, not an afterthought, so it needs to read as one.
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 12, height: 46, paddingHorizontal: 16,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.card,
  },
  // Layered onto `locationBtn` only while neither path to a location is
  // satisfied yet -- same danger tint as inputRequired below, so the
  // button reads as part of the same still-missing requirement as the
  // typed-town field above it, not as a separate, optional extra.
  locationBtnRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  locationBtnText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  locationHint: { fontSize: 12, color: colors.inkSoft, marginTop: 6 },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  orDividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orDividerText: { fontSize: 11.5, color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  // Both layered onto the divider only while location is still unmet --
  // the "or" is what tells the seller one of the two fields below is
  // enough, so it needs to stand out exactly when that choice still
  // matters, and fade back to a plain divider once either path is done.
  orDividerLineRequired: { backgroundColor: colors.danger },
  orDividerTextRequired: { color: colors.danger, fontWeight: '700' },
  mapWrap: { marginTop: 12 },
  geonamesAttribution: { fontSize: 10.5, color: colors.inkSoft, marginTop: 12 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  requiredMark: { color: colors.danger },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  // Layered onto `input` only while Title/Price is still empty -- see
  // RequiredMark's doc comment above for why the label asterisk alone
  // isn't enough. Clears itself the moment the seller fills it in. Same
  // tint as fieldStyles.inputRequired below (AdminModerationScreen's
  // existing removed/rejected badge background) for one consistent
  // danger-tint across the app.
  inputRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  // No fixed/min height here anymore -- the description TextInput sets its
  // own height inline (see its onContentSizeChange), seeded at the same
  // 100 this used to be fixed at.
  textarea: { paddingTop: 12, textAlignVertical: 'top' },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  translateLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  translateNotice: { marginTop: 16, gap: 10 },
  translateRetryBtn: {
    alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.pill, paddingHorizontal: 14, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  translateRetryText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  reviewPhoto: {
    // 3:4 (width:height) instead of a fixed pixel height -- tall enough to
    // do right by the vertical photos most sellers actually shoot, while
    // still showing a landscape photo without excessive letterboxing.
    // PhotoGallery crops to `cover` in this box; the uncropped original is
    // always still reachable by tapping through to the lightbox.
    aspectRatio: 3 / 4, width: '100%', borderRadius: radius.lg, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 16,
  },
  photoImg: { width: '100%', height: '100%' },
  reorderSection: { marginBottom: 18 },
  reorderHint: { color: colors.inkSoft, marginBottom: 10 },
  reorderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reorderThumb: { width: 44, height: 44, borderRadius: radius.sm },
  price: { fontSize: 24, fontWeight: '700', color: colors.ink },
  title: { ...type.h2, marginTop: 2, marginBottom: 2 },
  specsReview: { marginTop: 18, gap: 8 },
  specsReviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  // See ListingDetailScreen's specRowRTL comment -- same fix, same reason.
  specsReviewRowRTL: { flexDirection: 'row-reverse' },
  // See ListingDetailScreen's rtlText comment -- theme.ts's textAlign:
  // 'auto' resolves via I18nManager.isRTL on native (never flipped in
  // this app), not per-string content detection, so it didn't actually
  // right-align Arabic text on device. This explicit override does.
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  aiTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 10, height: 28, marginTop: 16,
  },
  aiTagText: { fontSize: 11.5, fontWeight: '600', color: colors.ink },
  // paddingBottom is plain -- Screen reserves the Android nav-bar inset
  // globally via its 'bottom' edge (see Screen.tsx).
  footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18 },
});
