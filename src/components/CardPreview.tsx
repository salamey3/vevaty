import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { SpinSet } from '../types';
import { sizedPhotoUrl } from '../lib/photoSize';
// The reader half of the frames/thumbnails pairing, shared with the two
// places that WRITE it -- see lib/thumbnailPairing.ts for why it is one file.
import { thumbnailsFor } from '../lib/thumbnailPairing';

// The hover/long-press preview on a listing card -- a quick look at more
// of the listing without leaving the grid. Mounted by ListingCard only
// while the card is actually being hovered or held, and unmounted the
// moment it isn't: the images below are extra network/decode cost on top
// of the one thumbnail every card already carries (see photoSize.ts's
// comment on bitmap heap), and a grid can have dozens of cards on screen
// at once, so nothing here should load until a shopper actually lingers
// on one.
//
// Two modes, chosen once and never mixed on the same card: a listing with
// a 360° spin previews the spin (that's the more informative of the two,
// and stacking a photo slideshow on top of it would just be noise); a
// listing with only flat photos previews those instead. A single photo or
// zero photos has nothing to preview, so this renders null and the
// static thumbnail underneath just keeps showing.
// `photoWidth` is the width this preview is actually drawn at, handed down
// by the card rather than assumed. It is the most memory-sensitive request
// in the app: a slideshow mounts up to five frames at once and a spin set
// mounts all of them, and RN decodes each at its SOURCE resolution however
// small the view is (see photoSize.ts). Asking one card-sized constant for
// every card in the app meant a small related-listing preview paid the same
// decoded bitmap as a full-width grid card.
//
// Worth knowing how far it goes: sizedPhotoUrl only rewrites the seeded
// picsum URLs, so this bounds the seed catalogue and nothing else. A real
// upload comes back from Bunny exactly as stored, and THIS component gets
// listing.photos -- the 1600px originals, not the baked thumbnail -- so a
// spin set here still mounts every frame at full size. That is the actual
// hazard on this path and it is untouched; a per-photo preview thumbnail is
// the fix, and it is not built.
export default function CardPreview({
  photos,
  spinSets,
  photoWidth,
}: {
  photos: string[];
  spinSets: SpinSet[];
  photoWidth: number;
}) {
  if (spinSets.length > 0) {
    return <SpinPreview spinSets={spinSets} photoWidth={photoWidth} />;
  }
  if (photos.length > 1) {
    return <PhotoSlideshow photos={photos.slice(0, PHOTO_PREVIEW_MAX)} photoWidth={photoWidth} />;
  }
  return null;
}

const PHOTO_PREVIEW_MAX = 5;
const PHOTO_SLIDE_MS = 700;

function PhotoSlideshow({ photos, photoWidth }: { photos: string[]; photoWidth: number }) {
  const [width, setWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widthRef = useRef(0);
  widthRef.current = width;

  useEffect(() => {
    if (width === 0) return; // wait for onLayout before scheduling anything

    const advance = () => {
      const next = indexRef.current + 1;
      Animated.timing(translateX, {
        toValue: -next * widthRef.current,
        duration: PHOTO_SLIDE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return; // unmounted mid-animation -- nothing left to schedule
        if (next === photos.length) {
          // Landed on the trailing clone of photo 0 (see `frames` below).
          // It's pixel-identical to the real photo 0, so snapping the
          // offset back to 0 here is an invisible jump instead of a
          // backward slide -- that's the whole reason the clone exists.
          indexRef.current = 0;
          translateX.setValue(0);
        } else {
          indexRef.current = next;
        }
        timerRef.current = setTimeout(advance, PHOTO_SLIDE_MS);
      });
    };

    timerRef.current = setTimeout(advance, PHOTO_SLIDE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      translateX.stopAnimation();
    };
    // width is captured via ref inside `advance`; only re-run once layout
    // has actually happened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width > 0]);

  // One extra frame at the end, a repeat of the first photo -- lets the
  // slide keep moving forward past the last real photo and land somewhere
  // pixel-identical to where it started, so looping back reads as
  // continuous motion instead of a snap backward to frame 1.
  const frames = [...photos, photos[0]];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Animated.View style={{ flexDirection: 'row', width: width * frames.length, height: '100%', transform: [{ translateX }] }}>
          {frames.map((uri, i) => (
            <Image
              key={`${uri}-${i}`}
              source={{ uri: sizedPhotoUrl(uri, photoWidth)! }}
              style={{ width, height: '100%' }}
            />
          ))}
        </Animated.View>
      )}
    </View>
  );
}

// HOW LONG ONE FULL TURN TAKES -- the only number to touch to change the
// speed of a card's spin preview. Lower is faster.
//
// It is a rotation time and not a per-frame delay, which is the point. The
// fixed 90ms per frame this replaces made the speed a function of however
// many frames the seller happened to shoot: a 12-frame spin turned in 1.1s
// and a 24-frame one took twice as long, so two cards side by side spun at
// visibly different speeds for no reason a shopper could see. Pacing by the
// turn makes every card on the grid rotate at the same rate whatever is
// behind it.
const SPIN_ROTATION_MS = 3250;

// The floor stops a 40-frame set from asking for a repaint every 80ms on a
// grid full of cards; the ceiling stops a short set -- an old one, or an
// auction lot below the 12-frame minimum -- from crawling frame by frame
// and reading as broken rather than slow.
const SPIN_FRAME_MIN_MS = 100;
const SPIN_FRAME_MAX_MS = 260;

function spinFrameMs(frameCount: number): number {
  if (frameCount <= 1) return SPIN_FRAME_MAX_MS;
  return Math.min(SPIN_FRAME_MAX_MS, Math.max(SPIN_FRAME_MIN_MS, Math.round(SPIN_ROTATION_MS / frameCount)));
}

function SpinPreview({ spinSets, photoWidth }: { spinSets: SpinSet[]; photoWidth: number }) {
  const [setIndex, setSetIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    // Plain mutable counters, not state, driving the interval -- the
    // interval closure is created once on mount and needs the CURRENT
    // position every tick, not the position from whichever render
    // happened to be active when it was created.
    let curSet = 0;
    let curFrame = 0;

    // Re-armed each tick rather than one fixed setInterval: the delay
    // depends on the CURRENT set's frame count, and a listing can carry
    // sets of different lengths ("Exterior" 24, "Interior" 12), so a
    // single interval fixed at mount would pace the second set by the
    // first one's frame count.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const frames = spinSets[curSet]?.frames ?? [];
      if (frames.length === 0) {
        timer = setTimeout(tick, SPIN_FRAME_MAX_MS);
        return;
      }
      curFrame += 1;
      if (curFrame >= frames.length) {
        // One full rotation of this spin just finished -- that's the
        // "longer the cursor stays" cue to move on to the next named
        // spin, e.g. Exterior then Interior. Wraps back to the first once
        // every spin on the listing has had its turn, so a long hover
        // just keeps cycling rather than stopping partway.
        curFrame = 0;
        curSet = (curSet + 1) % spinSets.length;
        setSetIndex(curSet);
      }
      setFrameIndex(curFrame);
      timer = setTimeout(tick, spinFrameMs(spinSets[curSet]?.frames.length ?? 0));
    };
    timer = setTimeout(tick, spinFrameMs(spinSets[0]?.frames.length ?? 0));

    return () => clearTimeout(timer);
  }, [spinSets]);

  // The card-sized copies where they exist, the originals where they do
  // not. Guarded on length rather than trusted: the two arrays are read by
  // index, so a mismatched one would draw frame 3 of a spin at position 7.
  const set = spinSets[setIndex];
  const frames = set ? thumbnailsFor(set.frames, set.previewFrames) : [];
  if (frames.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {frames.map((uri, i) => (
        <Image
          key={uri}
          source={{ uri: sizedPhotoUrl(uri, photoWidth)! }}
          style={[StyleSheet.absoluteFill, { opacity: i === frameIndex ? 1 : 0 }]}
        />
      ))}
    </View>
  );
}
