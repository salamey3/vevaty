import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { CategoryAttribute } from '../types';
import { sizedPhotoUrl } from '../lib/photoSize';
import {
  MAX_QTY, Variant, applyPhotoToDimension, countStock, fetchVariants, isLow, moveStock,
  photoByDimension, photoDimension, saveVariants, stockErrorKey, totalOf, variantLabel,
} from '../lib/stock';

// The shop's counter, on the seller's own listing page.
//
// Vevaty never sees the money, so nothing can tell the app a sale
// happened -- a number only ever moves because somebody said so. Two
// things follow, and this whole panel is shaped by them.
//
// First, saying so has to be almost free. One tap on minus is a sale.
// That is the action that happens twenty times a day, and if it costs a
// menu and a confirmation the shop stops doing it within a week and the
// numbers become worse than no numbers at all.
//
// Second, ADD and SET are different verbs and are never the same control.
// "A delivery came: +12" is right whatever else happened while the seller
// was typing. "There are 7" quietly swallows a sale made in the same
// minute. An editable box showing the current number invites the second
// while looking like the first, which is why there isn't one: the count
// is typed into a field that starts empty, under a heading that says what
// it means.
//
// Nothing here is optimistic. The server holds the row, refuses to go
// below zero rather than clamping, and hands back the number it settled
// on; that is what gets drawn. A stock figure that flickers to a guess
// and back is a stock figure nobody believes.

type Busy = { id: string; kind: 'minus' | 'add' | 'count' | 'tag' } | null;

export default function StockPanel({
  listingId, dims, couldHaveStock, photos, canTag, language, isRTL, t, onTotal, onRows,
}: {
  listingId: string;
  dims: CategoryAttribute[];
  // The listing's gallery as it stands on the server -- hosted URLs, which
  // is the whole reason the colour tagging lives here and not in the
  // posting form. During a first post these are still local files on the
  // phone, so anything tagged there would point at a URL that does not
  // exist yet.
  photos: string[];
  // Whether this listing is even the kind that keeps a stock table -- a
  // shop's listing in a bulk category. A private seller's one used jacket
  // is not, and without this a flaky connection showed them a "Could not
  // load your stock / Retry" box about stock they have never had, retrying
  // for ever against a table with no rows in it.
  couldHaveStock: boolean;
  // Whether the person looking may decide which photo belongs to which
  // colour. Counting is the counter's job and somebody the shop took on
  // does it; tagging goes through save_listing_variants, which rewrites
  // the whole size-and-colour table and parks any row it is not sent, so
  // the database keeps it to the owner. Without this the assistant would
  // be shown a control that always fails.
  canTag: boolean;
  language: 'en' | 'ar';
  isRTL: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
  // The listing's new total after a movement, so the page's own sold-out
  // mark follows the tap.
  onTotal: (total: number) => void;
  // The rows themselves, whenever they change. The seller sees this panel
  // AND the buyer's chooser on the same page: without this, pressing minus
  // here left the chooser directly below still saying "3 of this one in
  // stock" -- two counters on one screen disagreeing about the same shelf.
  onRows: (rows: Variant[]) => void;
}) {
  const [rows, setRows] = useState<Variant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [errorFor, setErrorFor] = useState<{ id: string; message: string } | null>(null);
  const [addText, setAddText] = useState('');
  const [countText, setCountText] = useState('');
  const [openTag, setOpenTag] = useState<string | null>(null);
  // Deliberately the SAME flag the counter uses, not a second one. Tagging
  // a photo re-reads and re-writes every row, so a sale landing in the
  // middle of one had its new number overwritten by the pre-sale answer --
  // the seller saw 5 where the shelf said 4, and minused again.
  const tagging = busy?.id === 'tag';

  // One place rows land, so the page above is told every time -- including
  // after a refusal, when the server's answer is the only true one.
  const takeRows = useCallback((next: Variant[]) => {
    setRows(next);
    onRowsRef.current(next);
  }, []);
  // Held in a ref so a caller passing an inline arrow does not re-run the
  // fetch on every render of the page.
  const onRowsRef = useRef(onRows);
  useEffect(() => { onRowsRef.current = onRows; }, [onRows]);

  // Which listing the rows on screen belong to. This screen is reused
  // when a buyer -- or a shop owner -- taps a related listing, and a slow
  // answer for the previous one landing here would put that listing's
  // real variant ids behind live minus buttons.
  const forListing = useRef(listingId);
  const load = useCallback(() => {
    setFailed(false);
    forListing.current = listingId;
    if (!couldHaveStock) { setRows([]); return; }
    const asked = listingId;
    fetchVariants(asked)
      .then((r) => { if (forListing.current === asked) takeRows(r); })
      .catch(() => { if (forListing.current === asked) { setRows(null); setFailed(true); } });
  }, [listingId, couldHaveStock, takeRows]);

  useEffect(() => { load(); }, [load]);

  // A listing with no table is a listing this panel has nothing to say
  // about -- a private seller's one jacket, or a shop item posted before
  // it had sizes. It renders nothing rather than an empty box.
  if (failed && couldHaveStock) {
    return (
      <View style={styles.block}>
        <Text style={styles.label}>{t('stock.panelTitle')}</Text>
        <View style={[styles.failRow, mirrorRow(isRTL)]}>
          <Text style={type.soft}>{t('stock.loadFailed')}</Text>
          <Pressy onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressy>
        </View>
      </View>
    );
  }
  if (!rows || rows.length === 0) return null;

  const run = async (row: Variant, kind: 'minus' | 'add' | 'count', n: number) => {
    if (busy) return;
    setBusy({ id: row.id, kind });
    setErrorFor(null);
    try {
      if (kind === 'count') {
        await countStock(row.id, n);
        const fresh = await fetchVariants(listingId);
        takeRows(fresh);
        onTotal(totalOf(fresh));
      } else {
        const r = await moveStock(row.id, kind === 'minus' ? -1 : n, kind === 'minus' ? 'sold' : 'restock');
        takeRows((rows ?? []).map((v) => (v.id === row.id ? { ...v, qty: r.after } : v)));
        onTotal(r.listingTotal);
      }
      setOpen(null);
      setAddText('');
      setCountText('');
    } catch (e: any) {
      setErrorFor({ id: row.id, message: t(stockErrorKey(e)) });
      // The row's real number after a refusal is whatever the server says
      // it is, not what this screen was showing when the tap landed --
      // two phones behind one counter is the ordinary case. Awaited rather
      // than left floating: a refetch that resolves after the NEXT
      // movement would paint that movement's old number back.
      try {
        const fresh = await fetchVariants(listingId);
        if (forListing.current === listingId) takeRows(fresh);
      } catch { /* leave what is on screen */ }
    } finally {
      setBusy(null);
    }
  };

  const total = totalOf(rows);
  const photoDim = photoDimension(dims);
  const tagged = photoDim ? photoByDimension(rows, photoDim.which) : {};
  // In the order the category lists them, and only values this listing
  // actually carries.
  const tagValues = photoDim
    ? photoDim.attr.options
        .map((o) => o.value)
        .filter((v) => rows.some((r) => (photoDim.which === 'a' ? r.a : r.b) === v))
    : [];

  // Saved straight away rather than behind a Save button: one tap, one
  // picture, and the seller sees it land. saveVariants sends every row, so
  // the rows NOT being tagged are sent exactly as they came back from the
  // server a moment ago -- which is why this reads from `rows` rather than
  // rebuilding anything.
  const tagPhoto = async (value: string, url: string | null) => {
    if (!photoDim || busy) return;
    setBusy({ id: 'tag', kind: 'tag' });
    setErrorFor(null);
    try {
      // Re-read first, and build the write from THAT. This is the panel's
      // only whole-table write, and save_listing_variants parks every row
      // it is not sent -- so tagging a photo against a table fetched when
      // the page opened would retire a size added from another device
      // since, silently. The panel is mounted for as long as the seller
      // leaves the page open.
      const live = await fetchVariants(listingId);
      takeRows(await saveVariants(listingId, applyPhotoToDimension(live, photoDim.which, value, url)));
      setOpenTag(null);
    } catch (e: any) {
      setErrorFor({ id: 'tag', message: t(stockErrorKey(e)) });
      try {
        const fresh = await fetchVariants(listingId);
        if (forListing.current === listingId) takeRows(fresh);
      } catch { /* leave what is on screen */ }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.block}>
      <View style={[styles.head, mirrorRow(isRTL)]}>
        <Text style={styles.label}>{t('stock.panelTitle')}</Text>
        <Text style={styles.total}>{t('stock.totalLeft', { n: total })}</Text>
      </View>

      {rows.map((row) => {
        const isOpen = open === row.id;
        const rowBusy = busy?.id === row.id;
        // By the ROW, not by the category: a listing posted before its
        // category gained a size still has a row with neither value, and
        // naming it off dims.length rendered it blank -- an unnamed line
        // with a minus button beside it.
        const label = !row.a && !row.b ? t('stock.plainRowLabel') : variantLabel(row, dims, language);
        return (
          <View key={row.id} style={styles.row}>
            <View style={[styles.rowTop, mirrorRow(isRTL)]}>
              <View style={styles.rowNameWrap}>
                <Text style={styles.rowName} numberOfLines={1}>{label}</Text>
                {!!row.sku && <Text style={styles.rowSku} numberOfLines={1}>{row.sku}</Text>}
              </View>
              <Pressy
                onPress={() => run(row, 'minus', 1)}
                disabled={!!busy || row.qty === 0}
                style={[styles.minus, row.qty === 0 && styles.minusOff]}
                accessibilityLabel={t('stock.soldOneOf', { what: label })}
              >
                {rowBusy && busy?.kind === 'minus' ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : (
                  <Text style={[styles.minusGlyph, row.qty === 0 && styles.minusGlyphOff]}>−</Text>
                )}
              </Pressy>
              <Pressy
                onPress={() => { setOpen(isOpen ? null : row.id); setAddText(''); setCountText(''); setErrorFor(null); }}
                style={styles.countTap}
                accessibilityLabel={t('stock.changeCountOf', { what: label })}
              >
                <Text style={[styles.count, row.qty === 0 && styles.countOut, isLow(row) && styles.countLow]}>
                  {row.qty}
                </Text>
              </Pressy>
            </View>

            {isLow(row) && row.qty > 0 && !isOpen && (
              <Text style={styles.lowNote}>{t('stock.runningLow', { n: row.qty })}</Text>
            )}
            {errorFor?.id === row.id && <Text style={styles.errorText}>{errorFor.message}</Text>}

            {isOpen && (
              <View style={styles.panel}>
                <Text style={styles.panelLabel}>{t('stock.deliveryCame')}</Text>
                <View style={[styles.panelRow, mirrorRow(isRTL)]}>
                  <TextInput
                    value={addText}
                    onChangeText={(v) => setAddText(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.inkSoft}
                    style={styles.panelInput}
                  />
                  <Pressy
                    onPress={() => run(row, 'add', Math.min(MAX_QTY, Number(addText) || 0))}
                    disabled={!!busy || !(Number(addText) > 0)}
                    style={[styles.panelBtn, !(Number(addText) > 0) && styles.panelBtnOff]}
                  >
                    {rowBusy && busy?.kind === 'add'
                      ? <ActivityIndicator size="small" color={colors.white} />
                      : <Text style={styles.panelBtnText}>{t('stock.addThem')}</Text>}
                  </Pressy>
                </View>

                <Text style={styles.panelLabel}>{t('stock.iCountedThem')}</Text>
                <Text style={styles.panelHint}>{t('stock.iCountedThemHint')}</Text>
                <View style={[styles.panelRow, mirrorRow(isRTL)]}>
                  <TextInput
                    value={countText}
                    onChangeText={(v) => setCountText(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="numeric"
                    placeholder={String(row.qty)}
                    placeholderTextColor={colors.inkSoft}
                    style={styles.panelInput}
                  />
                  <Pressy
                    onPress={() => run(row, 'count', Math.min(MAX_QTY, Number(countText) || 0))}
                    disabled={!!busy || countText === ''}
                    style={[styles.panelBtn, styles.panelBtnQuiet, countText === '' && styles.panelBtnOff]}
                  >
                    {rowBusy && busy?.kind === 'count'
                      ? <ActivityIndicator size="small" color={colors.ink} />
                      : <Text style={[styles.panelBtnText, styles.panelBtnQuietText]}>{t('stock.setIt')}</Text>}
                  </Pressy>
                </View>
              </View>
            )}
          </View>
        );
      })}
      {/* Which picture is the navy one. Asked HERE and not in the posting
          form because a first post's gallery is still on the phone when
          the listing saves -- tagging it there would tag a URL that does
          not exist yet and would save as nothing. The buyer's chooser
          moves the gallery to this picture when they pick that colour. */}
      {canTag && photoDim && photos.length > 0 && tagValues.length > 0 && (
        <View style={styles.tagBlock}>
          <Text style={styles.label}>
            {t('stock.photoPerValue', {
              what: language === 'ar' ? photoDim.attr.labelAr : photoDim.attr.labelEn,
            })}
          </Text>
          <Text style={styles.tagHint}>{t('stock.photoPerValueHint')}</Text>
          {errorFor?.id === 'tag' && <Text style={styles.errorText}>{errorFor.message}</Text>}
          {tagValues.map((value) => {
            const opt = photoDim.attr.options.find((o) => o.value === value);
            const name = opt ? (language === 'ar' ? opt.labelAr : opt.labelEn) : value;
            // A tag whose photo has since been deleted or replaced is not
            // a tag: showing it as one leaves the seller thinking that
            // colour is covered while the buyer's gallery jump silently
            // does nothing.
            const url = tagged[value] && photos.includes(tagged[value]) ? tagged[value] : null;
            const open = openTag === value;
            return (
              <View key={value}>
                <Pressy
                  onPress={() => setOpenTag(open ? null : value)}
                  disabled={!!busy}
                  style={[styles.tagRow, mirrorRow(isRTL), tagging && styles.tagBusy]}
                >
                  <Text style={styles.tagName} numberOfLines={1}>{name}</Text>
                  {url ? (
                    <Image source={{ uri: sizedPhotoUrl(url, 40) ?? url }} style={styles.tagThumb} />
                  ) : (
                    <Text style={styles.tagPick}>{t('stock.choosePhoto')}</Text>
                  )}
                </Pressy>
                {open && (
                  <View style={[styles.strip, mirrorRow(isRTL)]}>
                    {photos.map((uri, i) => (
                      <Pressy
                        key={`${value}-${i}`}
                        onPress={() => tagPhoto(value, url === uri ? null : uri)}
                        disabled={!!busy}
                        style={[styles.stripItem, url === uri && styles.stripItemOn, tagging && styles.tagBusy]}
                      >
                        <Image source={{ uri: sizedPhotoUrl(uri, 52) ?? uri }} style={styles.stripImage} />
                      </Pressy>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.foot}>{t('stock.panelFoot')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 16, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden',
  },
  // mirrorRow only supplies row-reverse on native RTL, so every row keeps
  // its own flexDirection or it stacks vertically on the web.
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.bg,
  },
  label: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5 },
  total: { fontSize: 13, fontWeight: '700', color: colors.ink },

  failRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14 },
  retry: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.primary, justifyContent: 'center' },
  retryText: { fontSize: 13, fontWeight: '700', color: colors.white },

  row: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowNameWrap: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14.5, color: colors.ink },
  rowSku: { ...type.tiny, marginTop: 1 },
  minus: {
    width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  minusOff: { opacity: 0.45 },
  // A text glyph rather than an Icon: the icon set is the listing-card
  // spec glyphs, and adding to it puts a stray entry in the admin's
  // per-attribute icon picker for the sake of one straight line.
  minusGlyph: { fontSize: 22, lineHeight: 24, fontWeight: '700', color: colors.ink },
  minusGlyphOff: { color: colors.inkSoft },
  countTap: { minWidth: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 19, fontWeight: '800', color: colors.ink },
  countLow: { color: colors.accentDeep },
  countOut: { color: colors.inkSoft },
  lowNote: { ...type.tiny, color: colors.accentDeep, marginTop: 4 },
  errorText: { ...type.tiny, color: colors.danger, marginTop: 6 },

  panel: { marginTop: 10, gap: 6 },
  panelLabel: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 4 },
  panelHint: { ...type.tiny, lineHeight: 15 },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelInput: {
    width: 88, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, textAlign: 'center', fontSize: 15, color: colors.ink,
  },
  panelBtn: {
    flex: 1, minWidth: 0, height: 42, borderRadius: radius.sm, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  panelBtnQuiet: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  panelBtnOff: { opacity: 0.45 },
  panelBtnText: { fontSize: 14, fontWeight: '700', color: colors.white },
  panelBtnQuietText: { color: colors.ink },

  tagBlock: { paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  tagHint: { ...type.tiny, lineHeight: 16, marginBottom: 4 },
  tagRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    backgroundColor: colors.bg, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8,
  },
  tagName: { flex: 1, minWidth: 0, fontSize: 14.5, color: colors.ink },
  tagBusy: { opacity: 0.5 },
  tagPick: { fontSize: 13, fontWeight: '700', color: colors.ink, textDecorationLine: 'underline' },
  tagThumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.card },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  stripItem: { borderWidth: 2, borderColor: 'transparent', borderRadius: radius.sm, padding: 1 },
  stripItemOn: { borderColor: colors.ink },
  stripImage: { width: 52, height: 52, borderRadius: radius.sm - 2, backgroundColor: colors.bg },

  foot: { ...type.tiny, paddingHorizontal: 14, paddingVertical: 10, lineHeight: 16 },
});
