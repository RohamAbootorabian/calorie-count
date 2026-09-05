/**
 * Shared profile + resolved-timezone plumbing (plan 0026). Home + the Daily /
 * Weekly / Monthly screens all need the single `useProfile()` and the resolved tz
 * (`resolveTimezone` treats a stored `'UTC'` default as the device zone, plan 0022);
 * this collapses the four near-identical copies into one hook.
 *
 * Each screen keeps its OWN data hook(s) + focus-refetch (those genuinely differ);
 * this shares only the tz + the profile loading/error branch. PRIVACY: never logs
 * the profile or the tz.
 */
import { resolveTimezone } from '@/features/auth/lib/profile-form';
import { useProfile, type Profile } from '@/features/auth/lib/use-profile';

export type ResolvedTz = {
  /** IANA zone for bucketing (device zone when the stored value is the DB default). */
  tz: string;
  /** The raw profile row (e.g. for the dashboard greeting), or null. */
  profile: Profile | null;
  profileLoading: boolean;
  profileError: boolean;
  refetchProfile: () => void;
};

export function useResolvedTz(): ResolvedTz {
  const { profile, loading, error, refetch } = useProfile();
  return {
    tz: resolveTimezone(profile?.timezone),
    profile,
    profileLoading: loading,
    profileError: error,
    refetchProfile: refetch,
  };
}
