import { useCallback, useState } from 'react';
import { LayoutChangeEvent, useWindowDimensions } from 'react-native';
import { carouselCardWidth, CAROUSEL_ROW_INSET } from '../lib/cardWidth';

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

// How wide the app centres its content on a desktop window. A constant
// rather than 1180 typed into twenty-three `Screen` calls because
// useCarouselCardWidth below has to predict it for one frame. It is the
// shared default for a full-page browse surface, not an enforced cap --
// `Screen` still takes any number, and the narrower surfaces (a payment
// sheet, an admin form, a chat thread) deliberately pass their own.
export const DESKTOP_CONTENT_MAX_WIDTH = 1180;

// The horizontal inset a page puts around itself on a phone. It is
// CAROUSEL_ROW_INSET and not a matching literal on purpose: on the mobile
// paths the same 36px comes from the row in one placement and from the grid
// around it in the other, so this estimate is only correct while the two
// numbers are the same one.
const MOBILE_PAGE_INSET = CAROUSEL_ROW_INSET;

// Comfortably wider than any scrollbar -- see the onLayout guard below.
const SCROLLBAR_HYSTERESIS = 20;

// How wide one card in a horizontal carousel row should be, plus the
// onLayout handler that makes it true.
//
// The width comes from the SAME breakpoints and gutter as the browse grid
// (see lib/cardWidth) -- one column's worth on a phone, two on a tablet,
// three on a desktop -- less the peek that keeps the row legible as a row.
//
// So a listing is the same size in a row as in a grid THAT GETS THE SAME
// WIDTH, which is every grid in the app except one: Home's filtered grid
// gives up a 240px filter sidebar and a 72px gutter, so a card there is
// narrower than the row that led to it. That gap is Home's sidebar
// arithmetic, already recorded in CARDS.md as its own unsolved problem, and
// matching it here would mean making every other row in the app narrower to
// agree with the one cramped grid.
//
// `rowInset` is the horizontal padding the row itself applies, which the
// caller knows and this cannot: these sections take a `flush` prop precisely
// because the page inset is sometimes theirs to add and sometimes their
// container's. Forgetting it is not a subtle error -- it double-counts 36px
// and puts the same component at two different sizes in two placements.
//
// MEASURED, for the reason ListingCard measures its photo: a window width is
// not a container width. Screen caps content at DESKTOP_CONTENT_MAX_WIDTH and
// reserves a 232px nav sidebar on the main tabs, neither of which a window
// width knows about, and a screen is free to pass a different cap.
//
// One live case proves the point rather than merely threatening to. A
// one-category domain (Properties) renders its collection rows inside
// HomeScreen's desktop grid branch, which also carries the 240px filter
// sidebar and a 72px gutter -- an 868px box where the estimate says 1180,
// wrong by 312. It is invisible today only because every collection kind is
// photo-left on desktop and sizes itself, so the number this hook returns is
// discarded there. Invisible by coincidence is exactly the kind of thing
// that stops being invisible.
//
// The estimate covers the first frame so cards do not visibly jump. On a
// phone in portrait it is exact on all three paths, flush or not: the 36px
// comes from the row on one and from the grid around it on the other, so the
// row's own usable width is the window less 36 either way. In landscape on a
// notched phone Screen's left/right safe-area edges take another ~94, which
// the estimate does not know about and the measurement corrects.
export function useCarouselCardWidth(rowInset: number) {
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = useIsDesktop();
  const columns = useListingGridColumns();
  const [measured, setMeasured] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w <= 0) return;
    // Hysteresis, not just an equality guard, and it is load-bearing rather
    // than an optimisation. This width sets the card's width, which sets its
    // height (a 4:3 photo), which sets the page's height, which on the web
    // can bring the outer scrollbar in or out -- and that changes this width
    // by the scrollbar's own ~15px. A page with a single short row sits
    // close enough to that threshold to flip back and forth forever.
    // Ignoring a change smaller than a scrollbar breaks the cycle at the one
    // point in it that has any state to break it with. The cost is that a
    // window resize under 20px does not resize the cards, which nobody can
    // see.
    setMeasured((prev) => (prev === 0 || Math.abs(w - prev) > SCROLLBAR_HYSTERESIS ? w : prev));
  }, []);

  const estimate = isDesktop
    ? Math.min(windowWidth - SIDEBAR_WIDTH, DESKTOP_CONTENT_MAX_WIDTH) - rowInset * 2
    : windowWidth - MOBILE_PAGE_INSET * 2;

  return {
    cardWidth: carouselCardWidth(measured ? measured - rowInset * 2 : estimate, columns),
    onLayout,
  };
}
