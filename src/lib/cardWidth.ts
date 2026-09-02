// How wide a listing card is, in a grid and in a carousel, decided in one
// place.
//
// It lived in two: ListingCard owned the grid percentages, and every
// carousel in the app passed a hardcoded `width={192}`. They drifted, which
// is the whole reason this file exists. The grid moved to one full-width
// column on a phone and three ~388px columns on a desktop; the carousels did
// not move at all, so the same listing was a roomy card in a filtered grid
// and a card half that size in the row you scrolled past to reach it. A
// reader has no way to know those are the same component -- it reads as two
// designs, and the compact one reads as the old one somebody forgot.

// Gutter between cards, as a percentage of the row. 3% reads well at two
// columns and far too wide at four or six -- the same proportion of a wider
// row is a much bigger gap in pixels, which is what left the desktop grid
// looking sparse. Scale it down as the columns go up.
function gridGutterPct(columns: number): number {
  return columns > 4 ? 0.5 : columns > 2 ? 0.7 : 1.2;
}

// How wide one grid card is, as a percentage of its row. Exported so the
// empty boxes that pad a short last row (see padRowsToFullColumns) are exactly
// as wide as the cards they stand in for -- if they were not, space-between
// would go on mis-spacing the row it was added to fix.
//
// Not floored: rounding each card down left the remainder to space-between,
// which quietly widened the gutters again beyond whatever was set here.
export function gridCardWidthPct(columns: number): `${number}%` {
  const gutter = gridGutterPct(columns);
  return `${Number(((100 - (columns - 1) * gutter) / columns).toFixed(3))}%`;
}

// The horizontal inset a carousel row puts around itself, and the gap it
// puts between cards. Exported and used by the row styles themselves, not
// just quoted here: the card width is computed from both, so a row that
// changed one of them without this file knowing would silently mis-size
// every card in it.
export const CAROUSEL_ROW_INSET = 18;
export const CAROUSEL_ROW_GAP = 6;

// How much of the NEXT card a carousel leaves showing.
//
// A carousel that shows a whole number of cards and nothing else is
// indistinguishable from a list of exactly that many. These rows carry six
// to ten items depending on which one it is, hide their scrollbar, and
// have no arrows on the sections this applies to, so the sliver of the next
// card is the ONLY thing telling a buyer there is more here.
//
// It cannot be left to fall out of the arithmetic. The grid's gutter is a
// percentage of the row and the row's gap is a flat 6px, so what three
// grid-width cards leave over is `0.014 * rowWidth - 12`. On desktop Home a
// 1180px window gives the row 948 of it (Screen reserves 232 for the nav
// sidebar), which leaves 1.3px; at the 1100 breakpoint where three columns
// start it leaves 0.15. Neither is a signal, and neither is visible.
//
// 44 rather than a token 12: the row's own gap eats 6 of it, leaving at
// least 38px of the next card's photo -- enough to read as a photo. On a row
// that is not flush the trailing inset adds to it, so a phone shows about 56.
export const CAROUSEL_PEEK = 44;

// Nothing below this, however small the box we are measured in. A card
// narrower than this cannot hold a two-line title and a spec row, and the
// only way to reach it is a container that measured wrong -- at which point
// a slightly-too-wide card is a far better failure than a stack of ellipses.
const MIN_CARD_WIDTH = 160;

// The pixel width of one card in a horizontal carousel row, given the width
// the row has to lay cards out in (its container MINUS its own insets -- see
// useCarouselCardWidth, which does that subtraction) and the column count the
// GRID would use at this breakpoint.
//
// Same columns and same gutter as the grid, so a listing is the same size in
// a row as in the grid that row leads to, less the peek above spread across
// the cards. At three columns that is ~15px a card, which is invisible beside
// a 388px grid card and buys the one thing the row cannot do without.
//
// Pixels, not a percentage, and that is forced rather than chosen: a
// percentage width inside a horizontally-scrolling content container
// resolves against the content's own width, which is what the children
// themselves determine. Every card would be a percentage of a number it is
// helping to compute.
export function carouselCardWidth(rowWidth: number, columns: number): number {
  const gutter = (rowWidth * gridGutterPct(columns)) / 100;
  const card = (rowWidth - CAROUSEL_PEEK - (columns - 1) * gutter) / columns;
  // Quantised to 8px so that dragging a desktop window does not produce a
  // new width, and therefore a re-render of every card in every row, on each
  // pixel of the drag. It is NOT what stops the scrollbar feedback loop --
  // a scrollbar is wider than this step, so quantising alone would happily
  // oscillate across it; useCarouselCardWidth's hysteresis is what handles
  // that, and it has to be stateful because the oscillation is.
  return Math.max(MIN_CARD_WIDTH, Math.floor(card / 8) * 8);
}
