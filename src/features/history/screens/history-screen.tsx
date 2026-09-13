/**
 * Meal History screen (plan 0012; search + date filter, plan 0033). Lists the
 * signed-in user's saved meals (newest first), lets them delete one (with
 * confirmation), and — new — search by dish name across ALL history + narrow by
 * date (presets or a custom range).
 *
 * FILTER UI STAYS MOUNTED (plan 0033 B1/B2): the full-screen spinner shows ONLY on
 * the initial load; every later filter change flips the hook's `refetching` (not
 * `loading`), so the pinned search box never unmounts mid-type (focus/keyboard
 * kept). Errors while filtering render inline so the user can still clear the filter.
 *
 * Delete is AWAIT-then-REFETCH (no optimistic rollback; plan 0012 review): mark the
 * id in-flight (gates the dialog AND the call), await `deleteMeal`, then `refetch()`
 * on success or show a non-PII inline message on failure. A `mounted` ref drops a
 * late setState if the screen unmounts (e.g. sign-out mid-delete).
 *
 * Confirmation is cross-platform: native `Alert.alert`; web `window.confirm`.
 * Pull-to-refresh uses `RefreshControl` (native); the header Refresh button is the
 * web refresh path. PRIVACY: the search term is a dish name (health-adjacent) — never
 * logged, never in analytics, never in a user-facing error string.
 */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Button, Card, DateField, Input, Text } from '@/shared/ui';

import { deleteMeal } from '../lib/delete-meal';
import { isFilterActive, type DatePreset, type HistoryFilter } from '../lib/history-filter';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { HISTORY_LIMIT, useMealHistory, type MealCard } from '../lib/use-meal-history';
import { useSignedThumbnails } from '../lib/use-signed-thumbnails';
import { PhotoLightbox } from './photo-lightbox';

/** Fixed thumbnail footprint — always reserved so the row height never jumps. */
const THUMB_SIZE = 56;

/** Date-filter presets shown as a wrapping chip row. */
const PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

/** Short, locale-aware "when eaten" label, e.g. "Jun 24, 2:15 PM". */
function formatEatenAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function round(n: number): number {
  return Math.round(n);
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const userId = user?.id ?? null;

  // --- Filter state (plan 0033) --------------------------------------------
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  // The active filter passed to the hook (debounced term → one query per pause).
  const filter = useMemo<HistoryFilter>(
    () => ({ search: debouncedSearch, preset, from: customFrom, to: customTo }),
    [debouncedSearch, preset, customFrom, customTo],
  );
  const filterActive = isFilterActive(filter);

  const { loading, refetching, meals, error, refetch } = useMealHistory(filter);
  const { urlFor, reportError } = useSignedThumbnails(meals);

  function selectPreset(next: DatePreset) {
    setPreset(next);
    // Custom needs two non-null Dates (DateField.value is non-null); seed sensible
    // defaults the first time (last 30 days) so both bounds always exist.
    if (next === 'custom') {
      if (!customFrom) {
        const from = new Date();
        from.setDate(from.getDate() - 29);
        setCustomFrom(from);
      }
      if (!customTo) setCustomTo(new Date());
    }
  }

  // Ids whose delete is in flight — gates the confirm dialog AND the call.
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteFailed, setDeleteFailed] = useState(false);
  // The full-screen photo viewer (plan 0016), or null. Holds the already-minted
  // signed URL in memory only — never serialized into a route. KEYED to the `userId`
  // it was opened for so a sign-out can't leave user A's signed URL on screen.
  const [lightbox, setLightbox] =
    useState<{ url: string; cacheKey: string; userId: string } | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reflect edits made on the edit screen (plan 0015): refetch when this screen
  // regains focus — but SKIP the very first focus (it coincides with the mount fetch).
  const hadFirstFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hadFirstFocus.current) {
        hadFirstFocus.current = true;
        return;
      }
      refetch();
    }, [refetch]),
  );

  const doDelete = useCallback(
    async (meal: MealCard) => {
      setDeletingIds((prev) => new Set(prev).add(meal.id));
      setDeleteFailed(false);
      const result = await deleteMeal(meal.id, meal.image_path);
      if (!mounted.current) return;
      if (result.ok) {
        refetch(); // reflect server truth; drops the row out of the list.
      } else {
        setDeleteFailed(true);
      }
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(meal.id);
        return next;
      });
    },
    [refetch],
  );

  const confirmThenDelete = useCallback(
    (meal: MealCard) => {
      if (deletingIds.has(meal.id)) return; // already in flight — ignore re-taps.
      const title = 'Delete this meal?';
      const message = "This can't be undone.";
      if (Platform.OS === 'web') {
        const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
        if (ok) void doDelete(meal);
        return;
      }
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void doDelete(meal) },
      ]);
    },
    [deletingIds, doDelete],
  );

  // --- Initial-load gates (filter UI not needed yet) ------------------------
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  // Initial error with nothing to show and no filter to preserve → full-screen retry.
  if (error && meals.length === 0 && !filterActive) {
    return (
      <Centered>
        <Text type="default" themeColor="textSecondary" style={styles.centerText}>
          Couldn&apos;t load your meals.
        </Text>
        <Button onPress={refetch}>Retry</Button>
      </Centered>
    );
  }

  const atLimit = meals.length >= HISTORY_LIMIT;

  const filterHeader = (
    <FilterHeader
      insetTop={insets.top}
      search={search}
      onSearch={setSearch}
      preset={preset}
      onPreset={selectPreset}
      customFrom={customFrom}
      customTo={customTo}
      onFrom={setCustomFrom}
      onTo={setCustomTo}
      refetching={refetching}
      onRefresh={refetch}
      error={error}
      deleteFailed={deleteFailed}
    />
  );

  return (
    <>
      <FlatListContainer
        pinned={filterHeader}
        data={meals}
        refetch={refetch}
        footer={
          atLimit ? (
            <Text type="small" themeColor="textSecondary" style={styles.notice}>
              Showing your {HISTORY_LIMIT} most recent {filterActive ? 'matching ' : ''}meals.
            </Text>
          ) : null
        }
        empty={
          <View style={styles.empty}>
            <Text type="default" themeColor="textSecondary" style={styles.centerText}>
              {filterActive
                ? 'No meals match your search or filters.'
                : 'No meals logged yet — snap one from Capture.'}
            </Text>
          </View>
        }
        renderItem={(meal) => {
          const thumbUrl = urlFor(meal.image_path);
          const path = meal.image_path;
          return (
            <MealRow
              meal={meal}
              thumbUrl={thumbUrl}
              deleting={deletingIds.has(meal.id)}
              onEdit={() => router.push({ pathname: '/meal-edit', params: { id: meal.id } })}
              onPressPhoto={
                thumbUrl && path && userId
                  ? () => setLightbox({ url: thumbUrl, cacheKey: path, userId })
                  : undefined
              }
              onDelete={() => confirmThenDelete(meal)}
              onThumbError={reportError}
            />
          );
        }}
      />
      {lightbox && lightbox.userId === userId && (
        <PhotoLightbox
          url={lightbox.url}
          cacheKey={lightbox.cacheKey}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

// --- Subcomponents ----------------------------------------------------------

function Centered({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, styles.centered, { backgroundColor: theme.background }]}>
      {children}
    </View>
  );
}

/**
 * Pinned filter block (search + presets + optional custom range) rendered ABOVE the
 * FlatList (not in a scrolling header) so it never scrolls away or unmounts mid-type.
 * Passed as a STABLE element — never `ListHeaderComponent={() => …}`.
 */
function FilterHeader({
  insetTop,
  search,
  onSearch,
  preset,
  onPreset,
  customFrom,
  customTo,
  onFrom,
  onTo,
  refetching,
  onRefresh,
  error,
  deleteFailed,
}: {
  insetTop: number;
  search: string;
  onSearch: (v: string) => void;
  preset: DatePreset;
  onPreset: (p: DatePreset) => void;
  customFrom: Date | null;
  customTo: Date | null;
  onFrom: (d: Date) => void;
  onTo: (d: Date) => void;
  refetching: boolean;
  onRefresh: () => void;
  error: boolean;
  deleteFailed: boolean;
}) {
  const today = new Date();
  return (
    <View style={[styles.filterWrap, { paddingTop: insetTop + Spacing.three }]}>
      <View style={styles.header}>
        <Text type="subtitle">History</Text>
        <View style={styles.headerRight}>
          {refetching ? <ActivityIndicator size="small" /> : null}
          <Pressable onPress={onRefresh} accessibilityRole="button" hitSlop={Spacing.two}>
            <Text type="link" themeColor="textSecondary">
              Refresh
            </Text>
          </Pressable>
        </View>
      </View>

      <Input
        value={search}
        onChangeText={onSearch}
        placeholder="Search by dish name"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />

      <View style={styles.chipRow}>
        {PRESETS.map((p) => (
          <Button
            key={p.value}
            variant={preset === p.value ? 'primary' : 'secondary'}
            onPress={() => onPreset(p.value)}
            style={styles.chip}>
            {p.label}
          </Button>
        ))}
      </View>

      {preset === 'custom' ? (
        <View style={styles.rangeRow}>
          <DateField
            label="From"
            value={customFrom ?? today}
            onChange={onFrom}
            maximumDate={today}
          />
          <DateField label="To" value={customTo ?? today} onChange={onTo} maximumDate={today} />
        </View>
      ) : null}

      {error ? (
        <Text type="small" themeColor="danger" style={styles.notice}>
          Couldn&apos;t load your meals — try again.
        </Text>
      ) : null}
      {deleteFailed ? (
        <Text type="small" themeColor="danger" style={styles.notice}>
          Couldn&apos;t delete — try again.
        </Text>
      ) : null}
    </View>
  );
}

type FlatListContainerProps = {
  pinned: React.ReactElement;
  data: MealCard[];
  refetch: () => void;
  footer: React.ReactElement | null;
  empty: React.ReactElement;
  renderItem: (meal: MealCard) => React.ReactElement;
};

function FlatListContainer({
  pinned,
  data,
  refetch,
  footer,
  empty,
  renderItem,
}: FlatListContainerProps) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {/* Pinned filter UI — outside the FlatList so it never scrolls away/unmounts. */}
      <View style={styles.pinnedContainer}>{pinned}</View>
      <FlatList
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => renderItem(item)}
        ListFooterComponent={footer}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
        ]}
        refreshControl={
          Platform.OS === 'web' ? undefined : (
            <RefreshControl refreshing={false} onRefresh={refetch} />
          )
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const MealRow = memo(function MealRow({
  meal,
  thumbUrl,
  deleting,
  onEdit,
  onPressPhoto,
  onDelete,
  onThumbError,
}: {
  meal: MealCard;
  thumbUrl: string | undefined;
  deleting: boolean;
  onEdit: () => void;
  /** Provided only when the photo has a minted URL → the thumbnail is tappable. */
  onPressPhoto?: () => void;
  onDelete: () => void;
  onThumbError: (path: string | null) => void;
}) {
  const thumbnail = (
    <Thumbnail
      key={meal.image_path ?? 'no-photo'}
      uri={thumbUrl}
      cacheKey={meal.image_path}
      onError={() => onThumbError(meal.image_path)}
    />
  );
  return (
    <Card>
      <View style={styles.rowTop}>
        {onPressPhoto ? (
          <Pressable onPress={onPressPhoto} accessibilityRole="button" accessibilityLabel="View photo">
            {thumbnail}
          </Pressable>
        ) : (
          thumbnail
        )}
        <View style={styles.rowInfo}>
          <Text type="smallBold" numberOfLines={1}>
            {meal.dish_name}
          </Text>
          <Text type="small" themeColor="textSecondary">
            {formatEatenAt(meal.eaten_at)}
          </Text>
        </View>
        {deleting ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.rowActions}>
            <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={Spacing.two}>
              <Text type="smallBold" themeColor="primary">
                Edit
              </Text>
            </Pressable>
            <Pressable onPress={onDelete} accessibilityRole="button" hitSlop={Spacing.two}>
              <Text type="smallBold" themeColor="danger">
                Delete
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.macros}>
        <Text type="small">{round(meal.total_calories)} kcal</Text>
        <Text type="small" themeColor="textSecondary">
          P {round(meal.total_protein)}g · C {round(meal.total_carbs)}g · F {round(meal.total_fat)}g
        </Text>
        {meal.quality_score != null && (
          <Text type="small" themeColor="textSecondary">
            Quality {meal.quality_score}/100
          </Text>
        )}
      </View>
    </Card>
  );
});

/**
 * Meal photo thumbnail (plan 0013). Fixed 56×56 footprint. Flat placeholder tile when
 * there's no URL yet or the image errors — and reports that error up so the path isn't
 * re-signed. Keyed to `image_path` by the parent so a changed photo remounts + resets.
 */
function Thumbnail({
  uri,
  cacheKey,
  onError,
}: {
  uri: string | undefined;
  cacheKey: string | null;
  onError: () => void;
}) {
  const theme = useTheme();
  const [errored, setErrored] = useState(false);

  if (!uri || errored) {
    return (
      <View
        style={[
          styles.thumb,
          styles.thumbPlaceholder,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}
      />
    );
  }
  return (
    <Image
      source={{ uri, cacheKey: cacheKey ?? undefined }}
      style={styles.thumb}
      contentFit="cover"
      transition={120}
      onError={() => {
        setErrored(true);
        onError();
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: { textAlign: 'center' },
  pinnedContainer: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
  },
  filterWrap: { gap: Spacing.two },
  listContent: {
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minWidth: 72 },
  rangeRow: { gap: Spacing.two },
  notice: { marginTop: Spacing.one },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.six,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  thumbPlaceholder: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowInfo: { flex: 1, gap: Spacing.half },
  macros: { marginTop: Spacing.two, gap: Spacing.half },
});
