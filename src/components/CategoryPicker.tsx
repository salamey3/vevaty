import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import CategoryCard from './CategoryCard';
import { colors, radius, type } from '../theme/theme';
import { useSettings } from '../store/SettingsStore';
import { useLanguage } from '../i18n/LanguageContext';
import { Category, CategoryId } from '../types';
import { useIsDesktop } from '../hooks/useResponsive';

// A pure tree-browsing category picker -- no AI involved. This is the
// manual fallback: CreateListingScreen's classify step reaches for this
// (wrapped in CategoryPickerModal) when the seller wants to browse rather
// than type into CategorySuggestInput, and it's also used standalone for
// browsing entry points that have nothing to photograph in the first
// place (there's no listing to classify from photos when you're looking
// for something to buy, not sell).
//
// Screen 1 (nothing picked yet, `path` empty): a big grid of every
// top-level category -- exactly the reference marketplace's initial
// "choose a category" screen.
//
// Once a top-level category is tapped, the picker switches to a
// persistent multi-pane browser on desktop (left column = all top-level
// categories, always visible so switching categories entirely needs no
// "back" step; each subsequent column = the children of whatever's
// selected in the column to its left) or a single-column drill-down on
// mobile (one pane visible at a time, with a back row above it) -- the
// two responsive equivalents of the same underlying idea.
//
// This is built generically over `childrenOf`/`ancestorsOf` rather than
// hard-coded to a fixed depth: a category with no children is a leaf and
// picking it calls `onSelect` immediately; a category with children just
// reveals the next pane. Right now the live taxonomy is exactly two
// levels deep (13 top-level x 101 subcategories, all leaves), but if an
// admin ever adds a third level under one of them, this component picks
// it up with no code change.
export default function CategoryPicker({
  value,
  onSelect,
}: {
  value: CategoryId | null;
  onSelect: (id: CategoryId) => void;
}) {
  const { categories, categoryById, childrenOf, ancestorsOf } = useSettings();
  const { language, t } = useLanguage();
  const isDesktop = useIsDesktop();

  // The chain of category ids currently being browsed, root-first --
  // independent of `value`, since `value` (the committed selection) only
  // ever points at a leaf, while the seller may be browsing a branch
  // that doesn't resolve to a leaf yet.
  const [path, setPath] = useState<CategoryId[]>(() => (value ? [...ancestorsOf(value).map((c) => c.id), value] : []));

  // Re-sync if `value` is set/changed from outside this component (e.g.
  // opening the edit flow on an existing listing).
  useEffect(() => {
    if (value && path[path.length - 1] !== value) {
      setPath([...ancestorsOf(value).map((c) => c.id), value]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const choose = (cat: Category, depth: number) => {
    const kids = childrenOf(cat.id);
    setPath([...path.slice(0, depth), cat.id]);
    if (kids.length === 0) onSelect(cat.id);
  };

  const reset = () => setPath([]);

  // Screen 1: the entry grid.
  if (path.length === 0) {
    return (
      <View style={styles.grid}>
        {categories.map((c) => (
          <CategoryCard key={c.id} category={c} onPress={() => choose(c, 0)} />
        ))}
      </View>
    );
  }

  // Build one pane per depth: pane 0 is always every top-level category;
  // pane i+1 exists only if path[i] actually has children.
  const panes: { items: Category[]; depth: number; selectedId: CategoryId | undefined }[] = [
    { items: categories, depth: 0, selectedId: path[0] },
  ];
  for (let i = 0; i < path.length; i++) {
    const kids = childrenOf(path[i]);
    if (kids.length > 0) panes.push({ items: kids, depth: i + 1, selectedId: path[i + 1] });
  }

  if (isDesktop) {
    return (
      <View>
        <Breadcrumb path={path} categoryById={categoryById} language={language} onJump={(depth) => setPath(path.slice(0, depth))} onReset={reset} allLabel={t('categoryPicker.allCategories')} />
        <View style={styles.paneRow}>
          {panes.map((pane, i) => (
            <ScrollView key={i} style={styles.pane} contentContainerStyle={styles.paneContent}>
              {pane.items.map((c) => (
                <PaneRow
                  key={c.id}
                  category={c}
                  language={language}
                  selected={pane.selectedId === c.id}
                  hasChildren={childrenOf(c.id).length > 0}
                  onPress={() => choose(c, pane.depth)}
                />
              ))}
            </ScrollView>
          ))}
        </View>
      </View>
    );
  }

  // Mobile: only the deepest active pane is visible at once.
  const currentPane = panes[panes.length - 1];
  const parent = currentPane.depth > 0 ? categoryById(path[currentPane.depth - 1]) : undefined;
  const goBack = () => setPath(path.slice(0, Math.max(0, currentPane.depth - 1)));

  return (
    <View>
      <Pressy onPress={currentPane.depth === 0 ? reset : goBack} style={styles.mobileBackRow}>
        <Icon name="back" size={14} color={colors.inkSoft} />
        <Text style={styles.mobileBackText}>{t('common.back')}</Text>
      </Pressy>
      <Text style={styles.mobileHeader}>
        {parent ? (language === 'ar' ? parent.nameAr : parent.nameEn) : t('categoryPicker.allCategories')}
      </Text>
      {currentPane.items.map((c) => (
        <MobileRow
          key={c.id}
          category={c}
          language={language}
          selected={currentPane.selectedId === c.id}
          hasChildren={childrenOf(c.id).length > 0}
          onPress={() => choose(c, currentPane.depth)}
        />
      ))}
    </View>
  );
}

function Breadcrumb({
  path,
  categoryById,
  language,
  onJump,
  onReset,
  allLabel,
}: {
  path: CategoryId[];
  categoryById: (id: string) => Category | undefined;
  language: 'en' | 'ar';
  onJump: (depth: number) => void;
  onReset: () => void;
  allLabel: string;
}) {
  return (
    <View style={styles.breadcrumbRow}>
      <Pressy onPress={onReset}>
        <Text style={styles.breadcrumbLink}>{allLabel}</Text>
      </Pressy>
      {path.map((id, i) => {
        const c = categoryById(id);
        if (!c) return null;
        const label = language === 'ar' ? c.nameAr : c.nameEn;
        const isLast = i === path.length - 1;
        return (
          <React.Fragment key={id}>
            <Icon name="chevronRight" size={12} color={colors.inkSoft} />
            {isLast ? (
              <Text style={styles.breadcrumbCurrent} numberOfLines={1}>{label}</Text>
            ) : (
              <Pressy onPress={() => onJump(i + 1)}>
                <Text style={styles.breadcrumbLink} numberOfLines={1}>{label}</Text>
              </Pressy>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function PaneRow({
  category,
  language,
  selected,
  hasChildren,
  onPress,
}: {
  category: Category;
  language: 'en' | 'ar';
  selected: boolean;
  hasChildren: boolean;
  onPress: () => void;
}) {
  const label = language === 'ar' ? category.nameAr : category.nameEn;
  return (
    <Pressy onPress={onPress} style={[styles.paneRowItem, selected && styles.paneRowSelected]}>
      <Text style={[styles.paneRowText, selected && styles.paneRowTextSelected]} numberOfLines={1}>{label}</Text>
      {hasChildren && <Icon name="chevronRight" size={13} color={selected ? colors.white : colors.inkSoft} />}
    </Pressy>
  );
}

function MobileRow({
  category,
  language,
  selected,
  hasChildren,
  onPress,
}: {
  category: Category;
  language: 'en' | 'ar';
  selected: boolean;
  hasChildren: boolean;
  onPress: () => void;
}) {
  const label = language === 'ar' ? category.nameAr : category.nameEn;
  return (
    <Pressy onPress={onPress} style={styles.mobileRowItem}>
      <Text style={[styles.mobileRowText, selected && styles.mobileRowTextSelected]}>{label}</Text>
      {hasChildren ? (
        <Icon name="chevronRight" size={16} color={colors.inkSoft} />
      ) : (
        selected && <Icon name="check" size={16} color={colors.ink} strokeWidth={2.2} />
      )}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  breadcrumbLink: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
  breadcrumbCurrent: { fontSize: 12.5, fontWeight: '700', color: colors.ink, maxWidth: 180 },

  paneRow: { flexDirection: 'row', gap: 1, backgroundColor: colors.line, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  pane: { flex: 1, minWidth: 0, maxHeight: 420, backgroundColor: colors.card },
  paneContent: { paddingVertical: 6 },
  paneRowItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, height: 42,
  },
  paneRowSelected: { backgroundColor: colors.primary },
  paneRowText: { fontSize: 13.5, fontWeight: '500', color: colors.ink, flex: 1 },
  paneRowTextSelected: { color: colors.white, fontWeight: '600' },

  mobileBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  mobileBackText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft },
  mobileHeader: { ...type.h3, marginBottom: 10 },
  mobileRowItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  mobileRowText: { fontSize: 14.5, color: colors.ink },
  mobileRowTextSelected: { fontWeight: '700' },
});
