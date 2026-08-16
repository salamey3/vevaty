import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View, ViewStyle } from 'react-native';
import Icon from '../icons/Icon';
import { colors } from '../theme/theme';

// A small, dependency-free vertical drag-to-reorder list. Built on
// PanResponder + Animated.Value (both core React Native, well-supported
// on react-native-web) instead of react-native-draggable-flatlist, which
// needs react-native-reanimated -- not installed in this project, and
// this app has repeatedly hit subtle react-native-web breakage from
// less-common libraries, so a small custom component here is the safer
// bet than adding a new native dependency to the build.
//
// Every row must be the same fixed `rowHeight` -- that's what lets drag
// position translate directly to a target index (`dy / rowHeight`)
// without measuring each row's real layout.
//
// Only the grip handle (rendered by this component, to the left of
// whatever `renderItem` returns) starts a drag -- tapping the rest of a
// row behaves like a normal tap (e.g. a toggle switch inside it).
export default function DraggableList<T>({
  data,
  keyExtractor,
  rowHeight,
  renderItem,
  onReorder,
  disabled = false,
}: {
  data: T[];
  keyExtractor: (item: T) => string;
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onReorder: (orderedKeys: string[]) => void;
  disabled?: boolean;
}) {
  // The settled order -- only updated when a drag is released. Rendering
  // during an active drag is computed from this plus the live gesture
  // state below, so we never mutate `order` mid-gesture.
  const [order, setOrder] = useState<string[]>(() => data.map(keyExtractor));
  const orderKey = data.map(keyExtractor).join('|');
  const prevOrderKeyRef = useRef(orderKey);
  if (prevOrderKeyRef.current !== orderKey) {
    prevOrderKeyRef.current = orderKey;
    // Re-sync when the caller's data actually changes (items added/
    // removed/toggled elsewhere) -- but not on every render.
    if (order.join('|') !== orderKey) setOrder(data.map(keyExtractor));
  }

  const byKey = useMemo(() => {
    const m = new Map<string, T>();
    data.forEach((item) => m.set(keyExtractor(item), item));
    return m;
  }, [data, keyExtractor]);

  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [overIndex, setOverIndex] = useState(0);
  const dragY = useRef(new Animated.Value(0)).current;

  // Refs mirroring the latest render's values. PanResponder callbacks can
  // be invoked from an instance that was built several renders ago (see
  // the panResponderCache comment below), so they must read current state
  // through refs rather than closing over a state variable that would
  // otherwise be frozen at whatever render created that particular
  // PanResponder instance.
  const orderRef = useRef(order);
  orderRef.current = order;
  const overIndexRef = useRef(overIndex);
  overIndexRef.current = overIndex;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  const commitDrag = (key: string) => {
    setOrder((prev) => {
      const from = prev.indexOf(key);
      const to = overIndexRef.current;
      if (from === -1 || from === to) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, key);
      onReorder(next);
      return next;
    });
    setDraggingKey(null);
  };
  const commitDragRef = useRef(commitDrag);
  commitDragRef.current = commitDrag;

  // Each row gets its own PanResponder, but it must NOT be rebuilt on
  // every render. onPanResponderMove calls setOverIndex, which re-renders
  // this component -- if we called PanResponder.create() fresh on that
  // re-render (as an earlier version of this component did), the
  // browser's native mousemove/mouseup events would end up routed to a
  // BRAND NEW PanResponder instance that never received the original
  // onPanResponderGrant, so its internal start-position tracking would be
  // empty and every subsequent move would compute a near-zero delta
  // instead of the true cumulative drag distance -- and onPanResponder
  // Release would fire from whichever instance happened to be current at
  // drop time, closing over a stale `overIndex` from whenever THAT
  // instance was built. Caching by key, and only rebuilding when this
  // row's index actually changes (which happens only between drags, never
  // mid-gesture, since `order` itself is untouched until release), keeps
  // the SAME instance -- and its correct internal gesture tracking --
  // attached for the whole gesture.
  const panResponderCache = useRef(new Map<string, { index: number; responder: ReturnType<typeof PanResponder.create> }>()).current;

  const panResponderFor = (key: string, index: number) => {
    const cached = panResponderCache.get(key);
    if (cached && cached.index === index) return cached.responder;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: () => {
        setDraggingKey(key);
        setStartIndex(index);
        setOverIndex(index);
        dragY.setValue(index * rowHeight);
      },
      onPanResponderMove: (_evt, gesture) => {
        dragY.setValue(index * rowHeight + gesture.dy);
        setOverIndex(clamp(index + Math.round(gesture.dy / rowHeight), 0, orderRef.current.length - 1));
      },
      onPanResponderRelease: () => commitDragRef.current(key),
      onPanResponderTerminate: () => commitDragRef.current(key),
    });
    panResponderCache.set(key, { index, responder });
    return responder;
  };

  return (
    <View style={{ height: order.length * rowHeight }}>
      {order.map((key, restIndex) => {
        const item = byKey.get(key);
        if (!item) return null;
        const isDragging = key === draggingKey;

        // Visual displacement for rows NOT being dragged: shift out of
        // the way of wherever the dragged row currently is, purely for
        // rendering -- `order` itself doesn't change until release.
        let translateY = restIndex * rowHeight;
        if (draggingKey && !isDragging) {
          if (overIndex > startIndex && restIndex > startIndex && restIndex <= overIndex) {
            translateY -= rowHeight;
          } else if (overIndex < startIndex && restIndex >= overIndex && restIndex < startIndex) {
            translateY += rowHeight;
          }
        }

        const panHandlers = panResponderFor(key, restIndex).panHandlers;

        return (
          <Animated.View
            key={key}
            style={[
              styles.row,
              { height: rowHeight },
              isDragging
                ? { transform: [{ translateY: dragY }], zIndex: 10, elevation: 6 }
                : { transform: [{ translateY }] },
            ]}
          >
            <View {...panHandlers} style={styles.handle}>
              <Icon name="grip" size={16} color={colors.inkSoft} />
            </View>
            <View style={styles.content}>{renderItem(item, restIndex)}</View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  handle: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none',
  } as unknown as ViewStyle,
  content: {
    flex: 1,
  },
});
