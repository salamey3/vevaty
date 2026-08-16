import React, { useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';

type Props = {
  frames: string[]; // hosted URLs, in capture order -- one 360° loop
};

const PX_PER_FRAME = 18; // ~18px of drag per frame -- a full loop on a
// 12-frame set is a comfortable ~216px drag on a phone-width screen.

// Drag-to-rotate viewer for a listing's 360° spin photo set (Phase 3 item
// 7). Built the same defensive way as RangeSlider.tsx: ONE PanResponder,
// created lazily and never rebuilt on re-render (see DraggableList.tsx's
// comment for why -- recreating a PanResponder mid-gesture orphans the
// browser's native mousemove/mouseup against a stale instance), reading
// the latest frame count/index through refs so the long-lived responder
// callbacks never close over a stale render.
//
// Fills its parent container, same contract as PhotoGallery.
export default function SpinViewer({ frames }: Props) {
  const [index, setIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);

  const framesRef = useRef(frames);
  framesRef.current = frames;
  const indexRef = useRef(index);
  indexRef.current = index;
  const grantIndexRef = useRef(0);

  const responderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responderRef.current) {
    responderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        grantIndexRef.current = indexRef.current;
        setHasInteracted(true);
      },
      onPanResponderMove: (_evt, gesture) => {
        const count = framesRef.current.length;
        if (count <= 1) return;
        const delta = Math.round(gesture.dx / PX_PER_FRAME);
        // Dragging left advances forward through the sequence -- an
        // arbitrary but common product-spin convention. Not flipped for
        // RTL: this rotates a physical object, not reading-direction
        // content, so the app's text/layout RTL handling doesn't apply.
        const next = (((grantIndexRef.current - delta) % count) + count) % count;
        setIndex(next);
      },
    });
  }

  if (frames.length === 0) return null;

  if (frames.length === 1) {
    return (
      <View style={styles.fill}>
        <Image source={{ uri: frames[0] }} style={styles.img} />
      </View>
    );
  }

  return (
    <View style={styles.fill} {...responderRef.current.panHandlers}>
      {frames.map((uri, i) => (
        <Image
          key={uri}
          source={{ uri }}
          style={[styles.img, styles.stacked, { opacity: i === index ? 1 : 0 }]}
        />
      ))}
      {!hasInteracted && (
        <View style={styles.hint} pointerEvents="none">
          <Icon name="rotate" size={14} color={colors.white} />
          <Text style={styles.hintText}>Drag to rotate</Text>
        </View>
      )}
      <View style={styles.counterPill} pointerEvents="none">
        <Text style={styles.counterText}>{index + 1}/{frames.length}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1, width: '100%', height: '100%',
    cursor: 'grab', touchAction: 'none',
  } as unknown as ViewStyle,
  img: { width: '100%', height: '100%' },
  stacked: { position: 'absolute', left: 0, top: 0 },
  hint: {
    position: 'absolute', top: 12, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(20,20,22,0.55)', borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  hintText: { ...type.tiny, color: colors.white },
  counterPill: {
    position: 'absolute', bottom: 10, alignSelf: 'center',
    backgroundColor: 'rgba(20,20,22,0.55)', borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  counterText: { ...type.tiny, color: colors.white },
});
