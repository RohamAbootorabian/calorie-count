/**
 * Meal History screen (plan 0012). Lists the signed-in user's saved meals
 * (newest first) and lets them delete one — with confirmation.
 *
 * Delete is AWAIT-then-REFETCH (no optimistic rollback; plan 0012 review): mark
 * the id in-flight (gates the dialog AND the call, so a double-tap can't stack
 * two confirms), await `deleteMeal`, then `refetch()` on success or show a
 * non-PII inline message on failure (the row simply stays — nothing was removed
 * optimistically). A `mounted` ref drops a late setState if the screen unmounts
 * (e.g. sign-out mid-delete).
 *
 * Confirmation is cross-platform: native `Alert.alert`; web `window.confirm`
 * (RN's `Alert` is unreliable on web). Pull-to-refresh uses `RefreshControl`
 * (native); the always-present header Refresh button is the web refresh path
 * (RefreshControl can no-op on web).
 */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import { Button, Card, Text } from '@/shared/ui';

import { deleteMeal } from '../lib/delete-meal';
import { HISTORY_LIMIT, useMealHistory, type MealCard } from '../lib/use-meal-history';
import { useSignedThumbnails } from '../lib/use-signed-thumbnails';
import { PhotoLightbox } from './photo-lightbox';

/** Fixed thumbnail footprint — always reserved so the row height never jumps. */
const THUMB_SIZE = 56;

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
  const { loading, meals, error, refetch } = useMealHistory();
  const { urlFor, reportError } = useSignedThumbnails(meals);
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Ids whose delete is in flight — gates the confirm dialog AND the call.
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  // True after a delete fails (transient/unknown) — a non-PII inline notice.
  const [deleteFailed, setDeleteFailed] = useState(false);
  // The full-screen photo viewer (plan 0016), or null when closed. Holds the
  // already-minted signed URL in memory only — never serialized into a route. KEYED
  // to the `userId` it was opened for: a render-time guard (not an effect) hides it
  // the instant the user changes, so a sign-out can't leave user A's signed URL on
  // screen (mirrors useSignedThumbnails' userId-keyed map; "derive, don't effect").
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
  // regains focus — but SKIP the very first focus (it coincides with the mount
  // fetch in `useMealHistory`, so refetching would double-fire and flip
  // `loading` mid-interaction). The mount fetch already has fresh data.
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
        // RN Alert is unreliable on web; window.confirm returns a real boolean.
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

  // --- Loading / error gates ------------------------------------------------
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (error) {
    return (
      <Centered>
        <Text type="default" themeColor="textSecondary" style={styles.centerText}>
          Couldn&apos;t load your meals.
        </Text>
        <Button onPress={refetch}>Retry</Button>
      </Centered>
    );
  }

  // --- List -----------------------------------------------------------------
  const atLimit = meals.length >= HISTORY_LIMIT;

  return (
    <>
    <FlatListContainer
      insetTop={insets.top}
      data={meals}
      refetch={refetch}
      header={
        <View style={styles.header}>
          <Text type="subtitle">History</Text>
          <Pressable onPress={refetch} accessibilityRole="button" hitSlop={Spacing.two}>
            <Text type="link" themeColor="textSecondary">
              Refresh
            </Text>
          </Pressable>
        </View>
      }
      subHeader={
        <>
          {deleteFailed && (
            <Text type="small" themeColor="danger" style={styles.notice}>
              Couldn&apos;t delete — try again.
            </Text>
          )}
        </>
      }
      footer={
        atLimit ? (
          <Text type="small" themeColor="textSecondary" style={styles.notice}>
            Showing your {HISTORY_LIMIT} most recent meals.
          </Text>
        ) : null
      }
      empty={
        <View style={styles.empty}>
          <Text type="default" themeColor="textSecondary" style={styles.centerText}>
            No meals logged yet — snap one from Capture.
          </Text>
        </View>
      }
      renderItem={(meal) => {
        // Compute the signed URL ONCE; reuse it for both the thumbnail and the
        // lightbox gate. `thumbUrl && path` narrows both to non-null, so the photo
        // opens only when there's a real URL (placeholder rows stay inert).
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

type FlatListContainerProps = {
  insetTop: number;
  data: MealCard[];
  refetch: () => void;
  header: React.ReactElement;
  subHeader: React.ReactElement;
  footer: React.ReactElement | null;
  empty: React.ReactElement;
  renderItem: (meal: MealCard) => React.ReactElement;
};

function FlatListContainer({
  insetTop,
  data,
  refetch,
  header,
  subHeader,
  footer,
  empty,
  renderItem,
}: FlatListContainerProps) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <FlatList
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => renderItem(item)}
        ListHeaderComponent={
          <View>
            {header}
            {subHeader}
          </View>
        }
        ListFooterComponent={footer}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: insetTop + Spacing.three,
            paddingBottom: BottomTabInset + Spacing.four,
          },
        ]}
        refreshControl={
          // Pull-to-refresh on native; web uses the header Refresh button.
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
      // Keyed to the photo so a changed image_path remounts → `errored` resets.
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
          // Hide both actions while a delete is in flight (the spinner replaces them).
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
 * Meal photo thumbnail (plan 0013). Always occupies a fixed 56×56 footprint so the
 * row height never jumps. Renders a flat themed placeholder tile when there's no
 * URL yet (null path / not-yet-minted / failed mint) or when the image errors
 * (e.g. a 404'd object) — and reports that error up so the path isn't re-signed.
 * The parent keys this component to `image_path`, so a changed photo remounts and
 * `errored` resets — a recycled row recovers without a setState-in-effect. `cacheKey`
 * keys expo-image's byte cache to the stable `image_path` (native), so the bytes
 * survive signed-URL rotation; web ignores it (browser caches by URL).
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
    marginBottom: Spacing.three,
  },
  notice: { marginBottom: Spacing.three },
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
