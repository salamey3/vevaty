// Keeping a listing grid's last row honest.
//
// Every listing grid lays its columns out with `justifyContent:
// 'space-between'`, and the card widths are percentages chosen so that a FULL
// row of them plus the gutters between them comes to exactly 100%. That works
// perfectly for every row except the last one, which is the only row that can
// be short -- and there `space-between` does what it is designed to do and
// pushes the survivors to opposite ends of the grid. Filter a three-column
// desktop grid down to two results and they end up a screen apart with a hole
// between them, which reads as a layout bug rather than as two results.
//
// The fix is to pad the data so the last row is full, and render the padding
// as empty boxes of the same width. Deliberately NOT the more elegant-looking
// alternative -- `justifyContent: 'flex-start'` with a percentage `columnGap`
// -- because percentage gaps are the kind of thing that silently does nothing
// on one of the two renderers this app ships on (Yoga on device,
// react-native-web in a browser) and then has to be discovered by eye. Empty
// boxes cannot silently do nothing.
//
// `columns === 1` returns the list untouched: a single-column grid has no
// short row and no columnWrapperStyle either.
export function padRowsToFullColumns<T>(items: T[], columns: number): (T | null)[] {
  if (columns <= 1 || items.length === 0) return items;
  const remainder = items.length % columns;
  if (remainder === 0) return items;
  return [...items, ...Array<null>(columns - remainder).fill(null)];
}

// Pairs with the above: a stable key for a padded slot. The spacers have no
// id, and two of them in the same list must not collide.
export function gridRowKey(item: { id: string } | null, index: number): string {
  return item ? item.id : `grid-spacer-${index}`;
}
