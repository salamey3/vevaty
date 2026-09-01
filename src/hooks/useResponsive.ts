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

// Below this, a listing grid is one column; above it, at least two. It exists
// because "phone" and "not desktop" are not the same thing: a rule with only
// the 860 breakpoint in it gave an iPad in portrait (768) and an 800px
// browser window a single 730px-wide card with a photo taller than most of
// the viewport.
export const TWO_COLUMN_BREAKPOINT = 600;

// And three columns only once the window can actually hold three. This is
// NOT the desktop breakpoint, deliberately. At 860 the desktop layout also
// switches on a 232px nav sidebar, a 240px filter sidebar and a 72px gutter,
// so the grid itself gets 316px of that window -- three columns of it is a
// 104px card, narrower than the two-column phone card this whole change was
// written to replace. Two columns of it is 156px, which is still tight; Home
// in a small desktop window is cramped by its own two sidebars and this only
// makes it less bad. Every other grid screen reserves no sidebar, so at 1100
// a card there is ~362px, and ~388px once the window passes the 1180 cap.
export const THREE_COLUMN_BREAKPOINT = 1100;

// How many LISTING cards sit across a browse grid. Its own named hook rather
// than five copies of the rule, because this is one decision about how the
// marketplace reads, not five coincidences -- and the last time a rule like
// this lived in several places (see conditionModes.ts) one of them was wrong
// for weeks.
//
// One column on a phone, down from two. A two-column phone card is about
// 175px, which fits everything the card says but leaves no room around any of
// it; at full width there is space for a photo somebody can actually judge a
// property from. The cost is honest and was accepted deliberately: roughly
// two listings per screen instead of four, so browsing takes more scrolling.
// It is the shape Dubizzle and OLX use on mobile in this market.
//
// Two on a large phone, a tablet, or a small desktop window; three on a
// desktop window with the room for it (down from four).
//
// Shop cards are NOT this -- ShopsDirectoryScreen keeps its own 2/4 grid,
// because a shop card is a logo and a name and does not want the room.
export function useListingGridColumns() {
  const { width } = useWindowDimensions();
  if (width >= THREE_COLUMN_BREAKPOINT) return 3;
  return width < TWO_COLUMN_BREAKPOINT ? 1 : 2;
}
