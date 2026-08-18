import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius } from '../theme/theme';

const THUMB_SIZE = 20;

type SingleProps = {
  mode: 'single';
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
};
type RangeProps = {
  mode: 'range';
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (min: number, max: number) => void;
  step?: number;
};
type Props = SingleProps | RangeProps;

// A small, dependency-free slider -- single-thumb (Distance) or dual-thumb
// (Price). Built the same defensive way as DraggableList.tsx: each
// thumb's PanResponder is created exactly ONCE (lazily, cached in a ref
// map keyed by thumb id) and never rebuilt on re-render, reading the
// latest props through a ref inside its handlers. DraggableList's own
// comment documents why rebuilding a PanResponder on every re-render is
// wrong here too: the browser's mousemove/mouseup keep targeting the
// ORIGINAL instance's internal gesture tracking, so a freshly-created
// responder never receives the grant event and computes near-zero deltas.
//
// Unlike DraggableList (which re-keys N row responders as items reorder),
// this component only ever has one or two thumbs with fixed identities
// ('min' | 'max' | 'single'), so a plain lazy-init cache is enough --
// no per-render rebuild logic is needed at all.
export default function RangeSlider(props: Props) {
  const { min, max } = props;
  const step = props.step ?? 1;
  const [trackWidth, setTrackWidth] = useState(0);

  const propsRef = useRef(props);
  propsRef.current = props;
  const trackWidthRef = useRef(trackWidth);
  trackWidthRef.current = trackWidth;
  const grantXRef = useRef<Record<string, number>>({});

  const clampToStep = (v: number, lo: number, hi: number) => {
    const stepped = Math.round((v - min) / step) * step + min;
    return Math.max(lo, Math.min(hi, stepped));
  };
  const posForValue = (v: number) => {
    const w = trackWidthRef.current;
    if (w <= 0 || max <= min) return 0;
    return ((v - min) / (max - min)) * w;
  };
  const valueForX = (x: number, lo: number, hi: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return lo;
    const ratio = Math.max(0, Math.min(1, x / w));
    return clampToStep(min + ratio * (max - min), lo, hi);
  };

  const respondersRef = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  const getResponder = (thumb: 'min' | 'max' | 'single') => {
    const cached = respondersRef.current[thumb];
    if (cached) return cached;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const p = propsRef.current;
        const current = p.mode === 'single' ? p.value : thumb === 'min' ? p.valueMin : p.valueMax;
        grantXRef.current[thumb] = posForValue(current);
      },
      onPanResponderMove: (_evt, gesture) => {
        const p = propsRef.current;
        const x = (grantXRef.current[thumb] ?? 0) + gesture.dx;
        if (p.mode === 'single') {
          p.onChange(valueForX(x, min, max));
        } else if (thumb === 'min') {
          p.onChange(valueForX(x, min, p.valueMax), p.valueMax);
        } else {
          p.onChange(p.valueMin, valueForX(x, p.valueMin, max));
        }
      },
    });
    respondersRef.current[thumb] = responder;
    return responder;
  };

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  const renderThumb = (thumb: 'min' | 'max' | 'single', value: number) => {
    const left = Math.max(0, Math.min(trackWidth, posForValue(value)) - THUMB_SIZE / 2);
    return (
      <View
        key={thumb}
        {...getResponder(thumb).panHandlers}
        style={[styles.thumb, { left }]}
      />
    );
  };

  const filledStyle =
    props.mode === 'single'
      ? { left: 0, width: Math.max(0, Math.min(trackWidth, posForValue(props.value))) }
      : {
          left: Math.max(0, Math.min(trackWidth, posForValue(props.valueMin))),
          width: Math.max(0, Math.min(trackWidth, posForValue(props.valueMax)) - Math.max(0, Math.min(trackWidth, posForValue(props.valueMin)))),
        };

  return (
    <View style={styles.wrap}>
      <View style={styles.track} onLayout={onLayout}>
        <View style={[styles.filled, filledStyle]} />
      </View>
      {props.mode === 'single' ? renderThumb('single', props.value) : (
        <>
          {renderThumb('min', props.valueMin)}
          {renderThumb('max', props.valueMax)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: THUMB_SIZE, justifyContent: 'center', marginVertical: 6 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'visible' },
  filled: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: colors.primary },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.ink,
    cursor: 'grab',
    touchAction: 'none',
    shadowColor: '#18181a',
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  } as unknown as ViewStyle,
});
