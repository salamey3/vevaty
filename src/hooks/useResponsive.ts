import { useWindowDimensions } from 'react-native';

// Below this viewport width, the app renders the exact same compact,
// phone-style layout it always has. At or above it (a laptop/desktop
// browser window), screens switch to a roomier layout: a persistent left
// sidebar instead of a floating bottom tab bar, wider grids, and centered
// content instead of edge-to-edge stretching.
export const DESKTOP_BREAKPOINT = 860;
export const SIDEBAR_WIDTH = 232;

export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_BREAKPOINT;
}

// Pick a grid column count depending on layout mode, without every screen
// re-deriving the breakpoint logic itself.
export function useGridColumns(mobileColumns: number, desktopColumns: number) {
  const isDesktop = useIsDesktop();
  return isDesktop ? desktopColumns : mobileColumns;
}
