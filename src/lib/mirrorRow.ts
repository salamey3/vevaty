import { Platform, ViewStyle } from 'react-native';

// Should a `flexDirection: 'row'` layout be mirrored by hand for Arabic?
//
// Only on native. On web LanguageContext sets
// `document.documentElement.dir = 'rtl'` (see applyDocumentDirection), and
// the browser then reverses the main axis of every row container on its
// own -- so a plain `row` already lays its children out right-to-left, and
// adding `row-reverse` on top of that flips them BACK to left-to-right.
// That double-flip is how the Arabic brand lockup ended up with the mark
// on the wrong side of the wordmark on the website while looking correct
// in the app.
//
// Native has no ambient direction at all: this app never flips
// I18nManager.isRTL, so on Android/iOS the mirror has to be spelled out.
//
// Exactly the same web-has-real-direction-support / native-doesn't split
// that useRtlCarousel documents for horizontal scrollers, and the same
// reason `textAlign: 'auto'` silently did nothing on device.
const NEEDS_MANUAL_MIRROR = Platform.OS !== 'web';

const ROW_REVERSE: ViewStyle = { flexDirection: 'row-reverse' };

export function mirrorRow(isRTL: boolean): ViewStyle | null {
  return isRTL && NEEDS_MANUAL_MIRROR ? ROW_REVERSE : null;
}
