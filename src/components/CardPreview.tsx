import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { SpinSet } from '../types';
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../lib/photoSize';

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
export default function CardPreview({ photos, spinSets }: { photos: string[]; spinSets: SpinSet[] }) {
  if (spinSets.length > 0) {
    return <SpinPreview spinSets={spinSets} />;
  }
  if (photos.length > 1) {
    return <PhotoSlideshow photos={photos.slice(0, PHOTO_PREVIEW_MAX)} />;
  }
  return null;
}

const PHOTO_PREVIEW_MAX = 5;
const PHOTO_SLIDE_MS = 1200;

function PhotoSlideshow({ photos }: { photos: string[] }) {
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
              source={{ uri: sizedPhotoUrl(uri, PHOTO_WIDTHS.card)! }}
              style={{ width, height: '100%' }}
            />
          ))}
        </Animated.View>
      )}
    </View>
  );
}

// Roughly a smooth rotation without costing more than a card thumbnail
// should: fast enough that a spin reads as motion, not a slideshow of its
// own frames.
const SPIN_FRAME_MS = 90;

function SpinPreview({ spinSets }: { spinSets: SpinSet[] }) {
  const [setIndex, setSetIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    // Plain mutable counters, not state, driving the interval -- the
    // interval closure is created once on mount and needs the CURRENT
    // position every tick, not the position from whichever render
    // happened to be active when it was created.
    let curSet = 0;
    let curFrame = 0;

    const timer = setInterval(() => {
      const frames = spinSets[curSet]?.frames ?? [];
      if (frames.length === 0) return;
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
    }, SPIN_FRAME_MS);

    return () => clearInterval(timer);
  }, [spinSets]);

  const frames = spinSets[setIndex]?.frames ?? [];
  if (frames.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {frames.map((uri, i) => (
        <Image
          key={uri}
          source={{ uri: sizedPhotoUrl(uri, PHOTO_WIDTHS.card)! }}
          style={[StyleSheet.absoluteFill, { opacity: i === frameIndex ? 1 : 0 }]}
        />
      ))}
    </View>
  );
}
