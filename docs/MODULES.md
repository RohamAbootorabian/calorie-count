# Module Map — splitting the app across parallel sessions

This document is how we divide Calorie Counter into independent workstreams so
multiple Claude sessions can build in parallel without colliding. Read it
alongside [WORKFLOW.md](WORKFLOW.md).

## The golden rule: trunk first, then parallelize

Some pieces are the foundation everything else depends on. If several sessions
build them at once, they constantly conflict. So we build the **trunk** with a
single session first, merge it to `main`, *then* fan out into feature modules.

## Phase A — the trunk (one session, sequential, FIRST)

Built by one session before any parallel work begins:

- **Database schema + RLS** — `profiles`, `goals`, `meal_logs`, `meal_items`, the
  `meal-photos` storage bucket, and row-level-security policies.
- **Shared types** — `src/types/` (the `MealAnalysis` contract already exists).
- **Design system** — `src/shared/ui/` (theme + base components: Button, Card, Input…).
- **Navigation skeleton** — the tab/stack layout every feature plugs into.
- **Auth plumbing** — session provider + a way to read the current user.

Until Phase A is on `main`, parallel feature work is blocked.

## Phase B — feature modules (parallel, one session each)

Once the trunk is merged, each module below is owned by a **separate session**,
working only inside its own folder.

| Module | Owner folder | DB tables / types used | Depends on | Produces / exposes |
|---|---|---|---|---|
| **Auth & Onboarding** | `src/features/auth/` | `profiles`, `goals` | Phase A | the logged-in user, goals |
| **Capture & AI Analysis** | `src/features/capture/` | `meal_logs`, Storage, `MealAnalysis` | Phase A | new `meal_logs` rows |
| **Diary & Tracking** | `src/features/diary/` | `meal_logs`, `meal_items` | Capture's data contract | daily totals view |
| **Trends & Quality Score** | `src/features/trends/` | `meal_logs` | Capture's data contract | charts, streaks, quality trend |

> "Profile & Settings" is small — fold it into the Auth session rather than
> spinning up a fifth track.

**Data flow:** Capture *produces* `meal_logs`; Diary and Trends *consume* them.
Because the `MealAnalysis` shape is frozen in `src/types/nutrition.ts` during
Phase A, Diary and Trends can build against mock data and integrate last.

## Folder structure (feature-based)

```
src/
  app/            # expo-router routes — thin; screens live in features
  features/
    auth/         # session 1
    capture/      # session 2
    diary/        # session 3
    trends/       # session 4
  shared/ui/      # design system (frozen in Phase A)
  lib/            # supabase client, env (shared, stable)
  types/          # the data contracts (shared, stable)
supabase/
  migrations/     # SQL schema + RLS
  functions/      # analyze-meal Edge Function
```

## Coordination rules (avoid collisions)

1. **One session owns one `features/<name>/` folder.** Don't edit another
   module's folder. Need a change there? Note it for that module's session.
2. **Branch + PR per parallel session.** While multiple sessions run at once we
   suspend the "commit straight to `main`" rule — each session works on
   `feat/<module>` and opens a small PR. (Solo/sequential work still goes
   straight to `main`.)
3. **Shared code is frozen during Phase B.** `types/`, `lib/`, and `shared/ui/`
   are defined in Phase A and changed rarely. A change there must be coordinated
   (it can break every module).
4. **Mock-first.** A consuming module (Diary, Trends) builds against fake
   `MealAnalysis` data so it doesn't block on Capture being finished.

## How a parallel session starts

1. Run `/session-start`.
2. Read this file + the module's row above to learn its boundary.
3. `/plan <task>` → `/review-plan` → execute, **only inside the module folder**.
4. Open a PR on `feat/<module>`; the integrating session (or the user) merges.
