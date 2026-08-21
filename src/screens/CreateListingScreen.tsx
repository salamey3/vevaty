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
import CategoryPicker from '../components/CategoryPicker';
import PhotoGallery from '../components/PhotoGallery';
import CameraCapture from '../components/CameraCapture';
import SpinPreviewModal from '../components/SpinPreviewModal';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { RootStackParamList } from '../navigation/types';
import { AttributeValue, Category, CategoryAttribute, CategoryId, ListingVariant, ListingVideo, SpinSet } from '../types';
import { attrHasValue, formatAttrValue } from '../lib/attributeFormat';
import { useLanguage } from '../i18n/LanguageContext';
import { translateListing } from '../lib/translate';
import { estimateListingPrice, suggestListingFromWeb, AiSuggestSource, AiSuggestAttributeSchema } from '../lib/aiSuggest';
import { photosForVision } from '../lib/imageToBase64';
import { mirrorRow } from '../lib/mirrorRow';
import { supabase } from '../lib/supabase';
import { getVehicleBrandNames, getModelsForBrand } from '../data/vehicleBrands';
import { LebanonPlace, findPlaceByExactName, findPlaceByFreeText, findPlaceById, nearestPlace } from '../data/lebanonPlaces';
import SuggestInput from '../components/SuggestInput';
import PlaceSuggestInput from '../components/PlaceSuggestInput';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import MagicListingModal, { MAGIC_MAX_PHOTOS, MAGIC_MIN_PHOTOS } from '../components/MagicListingModal';
import { classifyListingPhotos } from '../lib/classifyPhotos';
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

type StepKind = 'category' | 'photos' | 'spin' | 'specs' | 'stock' | 'details' | 'translate' | 'review';

// 360° spin capture frame count (Phase 3 item 7, raised from 8 to 12 after
// feedback that 8 (≥45°/frame) read as too choppy for bigger items like
// cars -- 12 frames is 30°/frame, the low end of standard commercial
// product-spin rigs, and reads as an actual smooth spin rather than a
// slideshow). Max 24 (15°/frame) caps upload size and seller tedium.
// How many photos a listing can carry in total. Was written out as a bare 6
// at each call site; named here because the in-camera batch has to know how
// many slots are left before it opens.
const PHOTOS_MAX = 6;
const SPIN_MIN_FRAMES = 12;
const SPIN_MAX_FRAMES = 24;

// Max number of gallery photos sent to the AI vision suggestion (see
// applyAiSuggestion below) -- enough for Claude to reliably identify the
// item and its visible condition without ballooning the request (each is
// resized/compressed client-side first, see imageToBase64.ts).
const AI_VISION_MAX_PHOTOS = 4;

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

// Classifies a category-attribute slug as a vehicle brand or model field
// (including the "compatible brand/model" slugs used on Spare
// Parts/Accessories), or null for anything else -- drives which specs
// get the Brand/Model suggestion UI instead of the generic AttributeField.
function vehicleSlugKind(slug: string): 'brand' | 'model' | null {
  const s = slug.toLowerCase();
  if (s === 'brand' || s === 'compatible_brand') return 'brand';
  if (s === 'model' || s === 'compatible_model') return 'model';
  return null;
}

export default function CreateListingScreen({ navigation, route }: Props) {
  const { addListing, updateListing, profile, listings, isVerified, authChecked, myShop } = useAppStore();
  const { categoryById, resolveAttributesForCategory, categoryMatches, allCategories, childrenOf } = useSettings();
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
  const [targetTitle, setTargetTitle] = useState(initialTargetTitle);
  const [targetDescription, setTargetDescription] = useState(initialTargetDescription);
  const [translating, setTranslating] = useState(false);
  // Starts true when editing a listing that already has the other-language
  // text filled in, so we don't clobber it with a fresh auto-translate.
  const [translateAttempted, setTranslateAttempted] = useState(!!(initialTargetTitle || initialTargetDescription));
  const [translateErrorMsg, setTranslateErrorMsg] = useState<string | null>(null);
  const [price, setPrice] = useState(editingListing ? String(editingListing.price) : '');
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
  const [usedDraft, setUsedDraft] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
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
  const [attachToShop, setAttachToShop] = useState<boolean>(!!editingListing?.shopId && editingListing.shopId === myShop?.id);
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
  const [shopChoiceResolved, setShopChoiceResolved] = useState<boolean>(false);

  // --- Magic Listing -----------------------------------------------------
  // The photo-first path: instead of picking a category and filling a form,
  // the seller shows the app the item and the app works out the rest. This
  // state is only the photo-collection step; once a category comes back the
  // seller rejoins the normal wizard, which is deliberate -- the AI's answer
  // lands in an editable form they walk through, never straight into a
  // published listing.
  const [magicVisible, setMagicVisible] = useState(false);
  const [magicPhotos, setMagicPhotos] = useState<string[]>([]);
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  // Set once a category comes back, so the jump to the next step happens
  // after `cat` (and therefore stepKinds) has actually updated -- computing
  // the target step in the same tick would use the old category's steps.
  const [magicJumpPending, setMagicJumpPending] = useState(false);
  // True once a Magic Listing has dropped the seller onto the Photos step,
  // so that step can explain why they are looking at photos they have
  // already taken.
  const [magicLanded, setMagicLanded] = useState(false);
  // True while `title` holds the plain item name the classifier produced
  // rather than something the seller wrote. The auto-suggestion below
  // refuses to run when there is already a title -- the point being not to
  // overwrite the seller's own words -- and a machine-written seed was
  // tripping that guard, so the Magic path stopped one step short of the
  // research it exists to do: it filled in "eufy camera" and then sat there
  // until the seller found the AI button and pressed it themselves.
  const [titleIsMagicSeed, setTitleIsMagicSeed] = useState(false);
  // Guided in-app capture for the Magic path, reusing the same CameraView
  // the 360 spin uses. The counter under the shutter is the point: the
  // seller sees "one more to go" while still holding the camera up, rather
  // than discovering afterwards that they were a photo short.
  const [magicCameraVisible, setMagicCameraVisible] = useState(false);
  // Set when a guided capture completes, so analysis starts by itself. The
  // seller has just watched the counter reach 3/3 -- asking them to then
  // find and press a button says nothing they don't already know.
  const [magicAutoAnalyze, setMagicAutoAnalyze] = useState(false);

  useEffect(() => {
    if (!magicAutoAnalyze) return;
    setMagicAutoAnalyze(false);
    if (magicPhotos.length >= MAGIC_MIN_PHOTOS) runMagic(magicPhotos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magicAutoAnalyze, magicPhotos]);

  const closeMagic = () => {
    setMagicVisible(false);
    setMagicError(null);
  };

  const runMagic = async (override?: string[]) => {
    const source = override ?? magicPhotos;
    setMagicBusy(true);
    setMagicError(null);
    const payload = await photosForVision(source, AI_VISION_MAX_PHOTOS);
    if (payload.length === 0) {
      setMagicBusy(false);
      setMagicError(t('createListing.magicPhotoReadFailed'));
      return;
    }
    // Leaves only: those are the only categories a listing can actually be
    // filed under, so offering "Vehicles" alongside "Cars for Sale" would
    // just let the model answer with something the form can't accept.
    const options = allCategories
      .filter((c) => c.active && childrenOf(c.id).length === 0)
      .map((c) => {
        const parent = c.parentId ? categoryById(c.parentId) : undefined;
        return {
          id: c.id,
          name: language === 'ar' ? c.nameAr : c.nameEn,
          parent: parent ? (language === 'ar' ? parent.nameAr : parent.nameEn) : undefined,
        };
      });
    const { data, error } = await classifyListingPhotos(payload, options, language);
    setMagicBusy(false);
    if (error) {
      setMagicError(error.message);
      return;
    }
    if (!data?.categoryId) {
      // An explicit "I can't tell" from the qualifier. The photos are still
      // worth keeping -- the seller picks the category by hand and the rest
      // of the flow (including the AI title/description pass) carries on
      // from there, so nothing they've done is wasted.
      setPhotos((prev) => [...prev, ...source].slice(0, PHOTOS_MAX));
      setMagicPhotos([]);
      closeMagic();
      Alert.alert(t('createListing.magicUnsureTitle'), t('createListing.magicUnsureMessage'));
      return;
    }
    setCategory(data.categoryId);
    setPhotos((prev) => [...prev, ...source].slice(0, PHOTOS_MAX));
    // A plain name for the item, which the AI suggestion pass then uses as
    // its seed and rewrites into a proper listing title.
    if (data.itemName && !title.trim()) {
      setTitle(data.itemName);
      setTitleIsMagicSeed(true);
    }
    setMagicPhotos([]);
    setMagicJumpPending(true);
    closeMagic();
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
  const specAttrs = useMemo(() => resolvedAttrs.filter((a) => !a.isVariant), [resolvedAttrs]);
  const hasSpecs = specAttrs.length > 0;
  // Category.stockMode -- see its own doc comment. 'unique' (everything
  // until this feature existed, and still the vast majority of
  // categories) never shows a Stock step at all.
  const hasStockStep = cat?.stockMode === 'multiple';
  // Whether there's at least one gallery photo -- the strongest signal the
  // AI vision suggestion (see applyAiSuggestion below) can work from, and
  // the trigger for starting that research immediately rather than waiting
  // for the Details step (see the auto-trigger effect below).
  const hasPhotoSignal = photos.length > 0;
  // Drives the Brand/Model suggestion fields below -- true for "Vehicles"
  // itself and every subcategory under it (Cars for Sale, Cars for Rent,
  // Motorcycles & ATVs, Trucks & Buses, Boats, Spare Parts, ...).
  const isVehicleCategory = category ? categoryMatches(category, 'vehicles') : false;
  // Drives the spin-name quick-pick chips (Living room/Kitchen/...) below,
  // same idea as isVehicleCategory -- true for "Properties" and everything
  // under it.
  const isPropertyCategory = category ? categoryMatches(category, 'properties') : false;
  const spinLabelSuggestions = spinLabelSuggestionsFor(isVehicleCategory, isPropertyCategory, language);

  const stepKinds: StepKind[] = useMemo(
    () => [
      'category',
      'photos',
      ...(cat?.supports3d ? (['spin'] as const) : []),
      ...(hasSpecs ? (['specs'] as const) : []),
      ...(hasStockStep ? (['stock'] as const) : []),
      'details',
      'translate',
      'review',
    ],
    [hasSpecs, cat?.supports3d, hasStockStep]
  );

  useEffect(() => {
    if (!magicJumpPending || !cat) return;
    // Land ON the photos step, not past it.
    //
    // This used to skip to whatever came next (spin, specs or details) on
    // the reasoning that Magic had already collected photos. But the three
    // photos Magic asks for are the ones the MODEL needs to recognise the
    // item -- which is not the same set a buyer needs to decide to message
    // you -- and the video control lives on this step too. Skipping it meant
    // a listing created through Magic could never gain a fourth photo or a
    // video at all, which is a strange thing for the fast path to cost you.
    //
    // Nothing is lost by stopping here: the AI title/description pass fires
    // on its own from the photos just set (see the auto-trigger effect
    // below), so it is still running in the background while the seller
    // decides whether to add anything.
    const photosStep = stepKinds.indexOf('photos');
    setStep(photosStep >= 0 ? photosStep : 0);
    setMagicLanded(true);
    setMagicJumpPending(false);
  }, [magicJumpPending, cat, stepKinds]);

  // Drives both the camera's own cap and the "you already have six" refusal.
  const photosRemaining = Math.max(0, PHOTOS_MAX - photos.length);

  const STEP_LABELS: Record<StepKind, string> = {
    category: t('createListing.stepCategory'),
    photos: t('createListing.stepPhotos'),
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

  // Opens the device camera directly instead of the gallery picker, for
  // sellers who don't already have photos of the item saved and would
  // rather shoot them on the spot. On web this hands off to the platform's
  // native capture UI via a file input with a `capture` attribute (see
  // ExponentImagePicker.web.ts) -- on a phone browser that's the actual
  // camera app; on desktop without a camera it degrades to the normal file
  // picker, so this is always safe to offer alongside "From Gallery" rather
  // than needing to be feature-detected away.
  const takePhotoInto = async (setter: React.Dispatch<React.SetStateAction<string[]>>, limit: number) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('createListing.photoPermTitle'), t('createListing.photoPermMessage'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled) {
      setter((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, limit));
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

  // Client-side re-check of one AI-suggested attribute value against its
  // real definition -- defense in depth on top of the edge function's own
  // (authoritative) validation, using the same rules: unparseable/
  // out-of-range values are dropped, never coerced (e.g. a bad number
  // must NOT become 0 -- that can be a real, wrong value). Returns
  // undefined when the value shouldn't be applied.
  const validateAiAttributeValue = (attribute: CategoryAttribute, value: unknown): AttributeValue | undefined => {
    if (value === undefined || value === null) return undefined;
    if (attribute.type === 'text') {
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 80 ? value.trim() : undefined;
    }
    if (attribute.type === 'number') {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
    if (attribute.type === 'boolean') {
      return typeof value === 'boolean' ? value : undefined;
    }
    if (attribute.type === 'select') {
      return typeof value === 'string' && attribute.options.some((o) => o.value === value) ? value : undefined;
    }
    if (attribute.type === 'multiselect') {
      if (!Array.isArray(value)) return undefined;
      const valid = value.filter((v): v is string => typeof v === 'string' && attribute.options.some((o) => o.value === v));
      return valid.length > 0 ? valid : undefined;
    }
    return undefined;
  };

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
    setSuggesting(true);
    setAiError(null);
    setAiPriceFilled(false);
    setAiAttributesFilled(false);
    setAiRateLimited(false);
    const categoryName = cat ? (language === 'ar' ? cat.nameAr : cat.nameEn) : '';
    // Resize/compress client-side before sending -- the first couple of
    // photos at a fidelity where printed brand/model text survives, the
    // rest cheaper (see photosForVision in imageToBase64.ts for why that
    // split exists). A photo that fails to read/encode is skipped rather
    // than blocking the whole suggestion.
    const photoPayload = hasPhotoSignal ? await photosForVision(photos, AI_VISION_MAX_PHOTOS) : [];
    const attributeSchema = hasSpecs ? buildAttributeSchemaForSuggestion() : [];
    const { data, error } = await suggestListingFromWeb(seedTitle, categoryName, language, specsLines, photoPayload, attributeSchema);
    setSuggesting(false);
    if (data) {
      setTitle(data.title);
      setTitleIsMagicSeed(false);
      setDescription(data.description);
      setUsedDraft(true);
      setAiSources(data.sources);
      setAiUncertain(data.uncertain);
      // Price is researched separately and NOT awaited. The describe call
      // measures ~9s; adding price research to it took the whole thing to
      // 19-27s, because pricing needs three web searches to identification's
      // one and each search is a round trip the model waits on. The title
      // and description are on screen and editable by now, so the seller
      // reads and edits while this lands rather than watching a spinner
      // for a number they usually overwrite anyway.
      const run = ++priceRunRef.current;
      estimateListingPrice(data.title || seedTitle, categoryName, language, data.identification, specsLines)
        .then((priced) => {
          if (!priced || run !== priceRunRef.current) return;
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
      // determine -- never overwrite anything the seller already set,
      // same fill-only-if-empty convention (reading current state via
      // closure, not a functional updater) as the price field above.
      if (data.attributes && Object.keys(data.attributes).length > 0) {
        const additions: Record<string, AttributeValue> = {};
        for (const a of specAttrs) {
          if (attrHasValue(attrValues[a.slug])) continue;
          const v = validateAiAttributeValue(a, data.attributes[a.slug]);
          if (v === undefined) continue;
          additions[a.slug] = v;
        }
        if (Object.keys(additions).length > 0) {
          setAttrValues((prev) => ({ ...prev, ...additions }));
          setAiAttributesFilled(true);
        }
      }
      if (profile.id !== 'me') {
        supabase
          .from('ai_listing_generations')
          .insert({
            seller_id: profile.id,
            suggested_title: data.title,
            suggested_description: data.description,
            suggested_specs: data.specs,
            suggested_attributes: data.attributes,
            price_range_low: data.priceRangeLow,
            price_range_high: data.priceRangeHigh,
            price_sources: data.sources,
            confidence: data.confidence,
            uncertain: data.uncertain,
            observed: data.observed,
            identification: data.identification,
            model: data.model,
            seller_accepted: true,
          })
          .then(() => {}, () => {});
      }
    } else if (error) {
      // Leave whatever the seller already typed alone -- they always have
      // at least a title at this point (guarded above), so silently
      // replacing it with the generic category template would be a worse
      // outcome than just surfacing the error and letting them retry or
      // keep writing it themselves.
      setAiSources([]);
      setAiUncertain([]);
      setAiError(error.message);
      setAiRateLimited(error.rateLimited);
    }
  };

  // Auto-run the AI suggestion as soon as there's signal to work from, and
  // no title yet (a fresh listing, not an edit of one that already has
  // text, and not a re-run after the seller already generated/typed
  // something). A photo is a complete, one-shot signal the instant it's
  // taken or picked -- unlike specs, which are filled in field-by-field
  // over the whole Specs step -- so this fires the moment `photos` goes
  // from empty to non-empty, from whichever step the seller happens to be
  // on (Photos, Spin, Specs), rather than waiting until Details. That way
  // the research is already done, or well underway, by the time Details
  // opens instead of starting the wait only then (the whole point of the
  // vision-based path, see applyAiSuggestion). A category with photos but
  // no Specs step gets the exact same early start. A specs-only category
  // (no photos at all) still waits for the Details step, since specs are
  // still being actively filled in on their own step until then.
  // `autoSuggestSignature` records what we've already auto-run for, so:
  // once photos exist, adding more of them doesn't keep re-firing (the
  // vision call only looks at the first few anyway, see
  // AI_VISION_MAX_PHOTOS) -- one attempt per photo-signal is enough.
  const [autoSuggestSignature, setAutoSuggestSignature] = useState<string | null>(null);
  useEffect(() => {
    const readyToFire = hasPhotoSignal || (hasSpecs && currentKind === 'details');
    if (!readyToFire || suggesting || (title.trim() && !titleIsMagicSeed)) return;
    const signature = hasPhotoSignal ? 'photos' : JSON.stringify({ attrValues });
    if (autoSuggestSignature === signature) return;
    setAutoSuggestSignature(signature);
    applyAiSuggestion({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKind, hasSpecs, hasPhotoSignal, title, suggesting, attrValues, autoSuggestSignature, titleIsMagicSeed]);

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
          // false lets React Navigation close the modal as usual -- back
          // out of the flow is the right answer from its first screen.
          return false;
        }
        setStep((prev) => Math.max(0, prev - 1));
        return true;
      });
      return () => sub.remove();
    }, [step, shouldAskShopChoice, shopChoiceResolved])
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

  const canNextByKind: Record<StepKind, boolean> = {
    category: !!category,
    photos: true, // photos optional in prototype
    spin: true, // spin capture is optional even in supports3d categories, same as photos
    specs: specsValid,
    // Never blocks Next -- a shop can post with everything at 0 (e.g.
    // "coming soon"), same "optional, not a gate" treatment as photos/spin.
    stock: true,
    details: title.trim().length > 0 && price.trim().length > 0,
    translate: true, // translation is a suggestion, never blocks posting
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

  const post = async () => {
    if (!category) return;
    setPosting(true);
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
    const payload = {
      cat: category,
      titleEn: language === 'en' ? title.trim() : targetTitle.trim(),
      titleAr: language === 'ar' ? title.trim() : targetTitle.trim(),
      descriptionEn: language === 'en' ? description.trim() : targetDescription.trim(),
      descriptionAr: language === 'ar' ? description.trim() : targetDescription.trim(),
      price: Number(price) || 0,
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
    };
    if (isEditMode && editListingId) {
      await updateListing(editListingId, payload);
      setPosting(false);
      navigation.navigate('ListingDetail', { listingId: editListingId });
    } else {
      const listing = await addListing(payload);
      setPosting(false);
      navigation.replace('ListingDetail', { listingId: listing.id });
    }
  };

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
    return (
      <Screen maxWidth={640}>
        <View style={styles.topBar}>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>{t('createListing.shopChooserTitle')}</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={fieldStyles.shopChooserWrap}>
          <Pressy
            onPress={() => { setAttachToShop(true); setShopChoiceResolved(true); }}
            style={fieldStyles.shopChooserCard}
          >
            <View style={fieldStyles.shopChooserIcon}>
              <Icon name="building" size={22} color={colors.primary} />
            </View>
            <Text style={fieldStyles.shopChooserCardTitle}>{t('createListing.shopChooserStorefrontTitle')}</Text>
            <Text style={fieldStyles.shopChooserCardBody}>
              {t('createListing.shopChooserStorefrontBody', { name: myShop!.nameEn })}
            </Text>
          </Pressy>
          <Pressy
            onPress={() => { setAttachToShop(false); setShopChoiceResolved(true); }}
            style={fieldStyles.shopChooserCard}
          >
            <View style={fieldStyles.shopChooserIcon}>
              <Icon name="bag" size={22} color={colors.primary} />
            </View>
            <Text style={fieldStyles.shopChooserCardTitle}>{t('createListing.shopChooserStandaloneTitle')}</Text>
            <Text style={fieldStyles.shopChooserCardBody}>{t('createListing.shopChooserStandaloneBody')}</Text>
          </Pressy>
        </View>
      </Screen>
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
        {currentKind === 'category' && (
          <CategoryPicker
            value={category}
            onSelect={setCategory}
            onMagicPress={() => { setMagicError(null); setMagicVisible(true); }}
          />
        )}

        {currentKind === 'photos' && (
          <View>
            <Text style={type.soft}>{t('createListing.photosIntro')}</Text>
            {magicLanded && (
              <View style={styles.magicLandedNotice}>
                <Icon name="sparkle" size={13} color={colors.inkSoft} />
                <Text style={[type.tiny, styles.magicLandedNoticeText]}>
                  {t('createListing.magicLandedHint', { count: photos.length })}
                </Text>
              </View>
            )}
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
            {cat && (
              <View style={styles.shotList}>
                <Text style={styles.sectionLabel}>{t('createListing.goodShotsFor', { category: (language === 'ar' ? cat.nameAr : cat.nameEn).toLowerCase() })}</Text>
                {(language === 'ar' ? cat.shotListAr : cat.shotListEn).map((s) => (
                  <View key={s} style={styles.shotItem}>
                    <Icon name="check" size={13} color={colors.inkSoft} />
                    <Text style={type.soft}>{s}</Text>
                  </View>
                ))}
              </View>
            )}
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
            {aiBackgroundNotice}
            {specAttrs.map((a) => {
              // Brand/model (and "compatible brand/model" on Spare
              // Parts/Accessories) get suggestion-backed inputs instead
              // of the generic AttributeField -- makes/models are a
              // helpful-suggestion case, not a fixed admin-defined
              // option set, so this intentionally overrides whatever
              // `type` the admin configured for these specific slugs.
              const vehicleKind = isVehicleCategory ? vehicleSlugKind(a.slug) : null;
              if (vehicleKind) {
                const label = language === 'ar' ? a.labelAr : a.labelEn;
                const fieldLabel = `${label}${a.required ? ' *' : ''}`;
                const value = attrValues[a.slug];
                const brandSlug = vehicleKind === 'model' ? 'brand' : 'compatible_brand';
                const suggestions =
                  vehicleKind === 'brand'
                    ? getVehicleBrandNames()
                    : getModelsForBrand(typeof attrValues[brandSlug] === 'string' ? (attrValues[brandSlug] as string) : '');
                return (
                  <View key={a.id}>
                    <Text style={fieldStyles.fieldLabel}>{fieldLabel}</Text>
                    <SuggestInput
                      onFocus={onInputFocus}
                      value={value === undefined ? '' : String(value)}
                      onChangeText={(v) => setAttrValue(a.slug, v)}
                      suggestions={suggestions}
                      placeholder={t('createListing.vehicleBrandModelPlaceholder')}
                    />
                  </View>
                );
              }
              return (
                <AttributeField
                  key={a.id}
                  onFocus={onInputFocus}
                  attribute={a}
                  language={language}
                  value={attrValues[a.slug]}
                  onChangeValue={(v) => setAttrValue(a.slug, v)}
                  onToggleMultiselect={(optionValue) => toggleMultiselectValue(a.slug, optionValue)}
                />
              );
            })}
          </View>
        )}

        {currentKind === 'stock' && (
          <View>
            <Text style={type.soft}>
              {variantAttr
                ? t('createListing.stockVariantIntro', { label: language === 'ar' ? variantAttr.labelAr : variantAttr.labelEn })
                : t('createListing.stockPlainIntro')}
            </Text>
            {variantAttr ? (
              <View style={fieldStyles.stockVariantList}>
                {variantAttr.options.map((o) => {
                  const label = language === 'ar' ? o.labelAr : o.labelEn;
                  return (
                    <View key={o.value} style={fieldStyles.stockVariantRow}>
                      <Text style={fieldStyles.stockVariantLabel}>{label}</Text>
                      <TextInput
                        onFocus={onInputFocus}
                        value={variantStock[o.value] ?? ''}
                        onChangeText={(v) =>
                          setVariantStock((prev) => ({ ...prev, [o.value]: v.replace(/[^0-9]/g, '') }))
                        }
                        keyboardType="numeric"
                        placeholder="0"
                        style={fieldStyles.stockVariantInput}
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              <>
                <Text style={fieldStyles.fieldLabel}>{t('createListing.stockQtyLabel')}</Text>
                <TextInput
                  onFocus={onInputFocus}
                  value={plainStockQty}
                  onChangeText={(v) => setPlainStockQty(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="1"
                  style={fieldStyles.input}
                />
              </>
            )}
          </View>
        )}

        {currentKind === 'details' && (
          <View>
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
            <Text style={styles.fieldLabel}>{t('createListing.title')}</Text>
            <TextInput
              onFocus={onInputFocus}
              value={title}
              onChangeText={(v) => { setTitle(v); setTitleIsMagicSeed(false); setUsedDraft(false); setAiSources([]); setAiUncertain([]); }}
              placeholder={categoryTitlePlaceholder}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>{t('createListing.description')}</Text>
            <TextInput
              onFocus={onInputFocus}
              value={description}
              onChangeText={(v) => { setDescription(v); setUsedDraft(false); setAiSources([]); setAiUncertain([]); }}
              placeholder={categoryDescriptionPlaceholder}
              multiline
              style={[styles.input, styles.textarea]}
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
            <Text style={styles.fieldLabel}>{t('createListing.price')}</Text>
            <TextInput
              onFocus={onInputFocus}
              value={price}
              onChangeText={(v) => { setPrice(v); setAiPriceFilled(false); }}
              placeholder="0"
              keyboardType="numeric"
              style={styles.input}
            />
            {aiPriceFilled && <Text style={styles.aiSourcesLabel}>{t('createListing.aiPriceFilledNotice')}</Text>}
            {aiAttributesFilled && <Text style={styles.aiSourcesLabel}>{t('createListing.aiAttributesFilledNotice')}</Text>}
            <Text style={styles.fieldLabel}>{t('createListing.location')}</Text>
            <PlaceSuggestInput
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
                two methods read as alternatives rather than a stray button. */}
            <View style={styles.orDivider}>
              <View style={styles.orDividerLine} />
              <Text style={styles.orDividerText}>{t('common.or')}</Text>
              <View style={styles.orDividerLine} />
            </View>
            <Pressy onPress={useMyLocation} style={styles.locationBtn} disabled={locating}>
              <Icon name="location" size={16} color={colors.ink} />
              <Text style={styles.locationBtnText}>
                {locating
                  ? t('common.loading')
                  : coordsFromSeller
                    ? t('createListing.locationCaptured')
                    : t('createListing.useMyLocation')}
              </Text>
            </Pressy>
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
                  placeholder={t('createListing.translateDescriptionPlaceholder')}
                  multiline
                  style={[styles.input, styles.textarea, targetLang === 'ar' && styles.rtlInput]}
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
            <Text style={styles.price}>${price || '0'}</Text>
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
          <Button label={t('common.continue')} disabled={!canNext} onPress={() => setStep((s) => s + 1)} />
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
        visible={magicCameraVisible}
        minFrames={MAGIC_MIN_PHOTOS}
        maxFrames={MAGIC_MAX_PHOTOS}
        instructions={t('createListing.magicCameraInstructions')}
        progressHint={(count, min) =>
          count === 0
            ? t('createListing.magicCameraStart', { min })
            : count < min
              ? t('createListing.magicCameraMore', { count, min, remaining: min - count })
              : t('createListing.magicCameraDone', { count })
        }
        autoFinishAtMin
        onFinish={(uris) => {
          setMagicCameraVisible(false);
          if (uris.length === 0) return;
          setMagicPhotos((prev) => [...prev, ...uris].slice(0, MAGIC_MAX_PHOTOS));
          setMagicAutoAnalyze(true);
        }}
        onCancel={() => setMagicCameraVisible(false)}
        onFallbackToLibrary={() => {
          setMagicCameraVisible(false);
          pickPhotosInto(setMagicPhotos, MAGIC_MAX_PHOTOS);
        }}
      />
      <MagicListingModal
        visible={magicVisible}
        photos={magicPhotos}
        busy={magicBusy}
        error={magicError}
        onTakePhoto={() => takePhotoInto(setMagicPhotos, MAGIC_MAX_PHOTOS)}
        onGuidedCapture={() => setMagicCameraVisible(true)}
        onPickPhotos={() => pickPhotosInto(setMagicPhotos, MAGIC_MAX_PHOTOS)}
        onRemovePhoto={(uri) => setMagicPhotos((prev) => prev.filter((p) => p !== uri))}
        onAnalyze={runMagic}
        onClose={closeMagic}
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
    </Screen>
  );
}

function AttributeField({
  attribute,
  language,
  value,
  onChangeValue,
  onToggleMultiselect,
  onFocus,
}: {
  attribute: CategoryAttribute;
  language: 'en' | 'ar';
  value: AttributeValue | undefined;
  onChangeValue: (v: AttributeValue) => void;
  onToggleMultiselect: (optionValue: string) => void;
  // Spec fields sit at the bottom of their step, so they are the ones most
  // likely to be under the keyboard when tapped.
  onFocus?: () => void;
}) {
  const label = language === 'ar' ? attribute.labelAr : attribute.labelEn;
  const unit = language === 'ar' ? attribute.unitAr : attribute.unitEn;
  const fieldLabel = `${label}${attribute.required ? ' *' : ''}${unit ? ` (${unit})` : ''}`;

  if (attribute.type === 'boolean') {
    return (
      <View style={fieldStyles.switchRow}>
        <Text style={fieldStyles.fieldLabel}>{fieldLabel}</Text>
        <Pressy onPress={() => onChangeValue(!value)} style={[fieldStyles.boolPill, !!value && fieldStyles.boolPillActive]}>
          <Text style={[fieldStyles.boolPillText, !!value && fieldStyles.boolPillTextActive]}>{value ? '✓' : ''}</Text>
        </Pressy>
      </View>
    );
  }

  if (attribute.type === 'select' || attribute.type === 'multiselect') {
    const selected: string[] = attribute.type === 'multiselect' ? (Array.isArray(value) ? (value as string[]) : []) : value ? [value as string] : [];
    return (
      <View>
        <Text style={fieldStyles.fieldLabel}>{fieldLabel}</Text>
        <View style={fieldStyles.pillRow}>
          {attribute.options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <Pressy
                key={opt.value}
                onPress={() => (attribute.type === 'multiselect' ? onToggleMultiselect(opt.value) : onChangeValue(opt.value))}
                style={[fieldStyles.optPill, isSelected && fieldStyles.optPillActive]}
              >
                <Text style={[fieldStyles.optPillText, isSelected && fieldStyles.optPillTextActive]}>
                  {language === 'ar' ? opt.labelAr : opt.labelEn}
                </Text>
              </Pressy>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={fieldStyles.fieldLabel}>{fieldLabel}</Text>
      <TextInput
        onFocus={onFocus}
        value={value === undefined ? '' : String(value)}
        onChangeText={(v) => onChangeValue(attribute.type === 'number' ? (v === '' ? '' : Number(v) || 0) : v)}
        keyboardType={attribute.type === 'number' ? 'numeric' : 'default'}
        style={fieldStyles.input}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
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
  shotList: { marginTop: 24, gap: 8 },
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
  shotItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  // Same shape as the AI notice above, on the plain surface rather than the
  // warn colour -- this one is an invitation, not something to act on.
  magicLandedNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 9, marginTop: 14,
  },
  magicLandedNoticeText: { ...type.tiny, textTransform: 'none', letterSpacing: 0, flex: 1, color: colors.inkSoft },
  draftBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 14, height: 36, marginBottom: 18,
  },
  draftBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
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
  // Deliberately styled like a real button (border, fill, centered) rather
  // than the old plain-text link -- it's an equally-valid alternative to
  // typing a town above, not an afterthought, so it needs to read as one.
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 12, height: 46, paddingHorizontal: 16,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.card,
  },
  locationBtnText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  locationHint: { fontSize: 12, color: colors.inkSoft, marginTop: 6 },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  orDividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orDividerText: { fontSize: 11.5, color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  mapWrap: { marginTop: 12 },
  geonamesAttribution: { fontSize: 10.5, color: colors.inkSoft, marginTop: 12 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  textarea: { height: 100, paddingTop: 12, textAlignVertical: 'top' },
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
