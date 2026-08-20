# Calorie Counter 📸🍽️

Snap a photo of your meal → get calories, macros (protein/carbs/fat), and
quality nutrients (sugar, salt, fiber) automatically, plus a **food quality
score** so you track *how well* you eat, not just how much.

## Tech stack

| Layer | Choice |
|---|---|
| App | Expo (React Native) + TypeScript, expo-router |
| Backend / DB / Auth / Storage | Supabase (Postgres + Auth + Storage + Edge Functions) |
| AI | OpenAI GPT-4o-mini vision, called from a Supabase Edge Function (`analyze-meal`) |
| Nutrition reference | USDA FoodData Central (free) for cross-checking known items |

### Golden rule

The phone **never** calls the AI provider directly. Photo → Supabase Edge
Function → OpenAI → structured `MealAnalysis` JSON → Postgres → phone. This
keeps API keys off the device and lets us tune the prompt without shipping an
app update.

## Project structure

```
src/
  app/          # expo-router screens (file-based routing)
  components/   # shared UI
  lib/          # env config + supabase client
  services/     # analyzeMeal() — client seam to the Edge Function
  types/        # nutrition.ts — the core MealAnalysis domain model
supabase/
  functions/    # analyze-meal (photo → nutrition) + cleanup-orphans (deployed to prod)
  migrations/   # Postgres schema, RLS, meal-log RPCs, scheduled cleanup
```

## Getting started

### 1. App (client)

```bash
# Install deps (already done if you scaffolded)
npm install

# Configure the public client env
cp .env.example .env   # then fill in your Supabase project URL + anon key

# Run it (scan the QR code with the Expo Go app on your phone, or press "w" for web)
npm start
```

No Xcode/Android Studio needed to start — install **Expo Go** on your phone and
scan the QR code. Add native tooling later when you need camera/build features.

### 2. Backend (Supabase) — required for photo analysis

The client above renders, but **meal analysis won't work until the backend is set
up**: the phone calls the `analyze-meal` Edge Function, which calls OpenAI. You need
the [Supabase CLI](https://supabase.com/docs/guides/cli) and an OpenAI API key.

```bash
# Link this repo to your Supabase project (ref = Settings → General → Reference ID)
supabase link --project-ref <your-project-ref>

# Apply the database schema, RLS, and meal-log RPCs
supabase db push

# Deploy the Edge Functions
supabase functions deploy analyze-meal
supabase functions deploy cleanup-orphans

# Set the Edge Function secrets (NEVER put these in .env — they stay server-side).
# The analyze-meal function reads OPENAI_API_KEY; cleanup-orphans reads CLEANUP_SECRET.
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set CLEANUP_SECRET=$(openssl rand -hex 32)
```

The scheduled orphan-photo cleanup is installed by the
`...schedule_orphan_cleanup` migration (pg_cron); it invokes the deployed
`cleanup-orphans` function. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
full data flow.

## Roadmap

### MVP (v1) — shipped
- [x] Auth + onboarding (set calorie/macro goals or compute from weight goal via TDEE)
- [x] Capture/upload meal photo
- [x] `analyze-meal` Edge Function → calories, macros, sugar/salt/fiber, confidence
- [x] Editable results (correct portion / swap items) — builds trust
- [x] Daily dashboard with running totals vs. goals

### Also shipped (beyond the original MVP list)
- [x] Delete a meal from History
- [x] History with meal-photo thumbnails
- [x] Full-screen photo lightbox (tap a thumbnail)
- [x] Edit a previously-saved meal
- [x] In-app privacy policy at `/privacy` (health-data + photo disclosure)
- [x] Automatic cleanup of orphaned meal photos (scheduled `cleanup-orphans`)

### v2 — differentiators
- [ ] **Food quality score** (processing, sugar/salt density, protein & fiber ratios)
- [ ] Trends & charts over time, streaks
- [ ] Barcode scanning for packaged food
- [ ] Water tracking, reminders, export for a coach/doctor

## Notes
- Calorie estimates from photos are **approximate** — portion size is the
  biggest error source. Always let users correct the estimate.
- Food photos + health data → an **in-app privacy policy** ships at `/privacy`
  (linked from sign-up, Settings, and the Capture screen; plan 0010). A public
  hosted-URL mirror is still pending a production web domain (tracked with the
  CORS prod-origin TODO) before store submission.
