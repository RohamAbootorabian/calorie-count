# Calorie Counter 📸🍽️

Snap a photo of your meal → get calories, macros (protein/carbs/fat), and
quality nutrients (sugar, salt, fiber) automatically, plus a **food quality
score** so you track *how well* you eat, not just how much.

## Tech stack

| Layer | Choice |
|---|---|
| App | Expo (React Native) + TypeScript, expo-router |
| Backend / DB / Auth / Storage | Supabase (Postgres + Auth + Storage + Edge Functions) |
| AI | Claude vision, called from a Supabase Edge Function (`analyze-meal`) |
| Nutrition reference | USDA FoodData Central (free) for cross-checking known items |

### Golden rule

The phone **never** calls the AI provider directly. Photo → Supabase Edge
Function → Claude → structured `MealAnalysis` JSON → Postgres → phone. This
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
  functions/    # analyze-meal Edge Function (to be created)
```

## Getting started

```bash
# 1. Install deps (already done if you scaffolded)
npm install

# 2. Configure environment
cp .env.example .env   # then fill in your Supabase URL + anon key

# 3. Run it (scan the QR code with the Expo Go app on your phone)
npm start
```

No Xcode/Android Studio needed to start — install **Expo Go** on your phone and
scan the QR code. Add native tooling later when you need camera/build features.

## Roadmap

### MVP (v1)
- [ ] Auth + onboarding (set calorie/macro goals or compute from weight goal)
- [ ] Capture/upload meal photo
- [ ] `analyze-meal` Edge Function → calories, macros, sugar/salt/fiber, confidence
- [ ] Editable results (correct portion / swap items) — builds trust
- [ ] Daily diary with running totals vs. goals

### v2 — differentiators
- [ ] **Food quality score** (processing, sugar/salt density, protein & fiber ratios)
- [ ] Trends & charts over time, streaks
- [ ] Barcode scanning for packaged food
- [ ] Water tracking, reminders, export for a coach/doctor

## Notes
- Calorie estimates from photos are **approximate** — portion size is the
  biggest error source. Always let users correct the estimate.
- Food photos + health data → we need a privacy policy before store submission.
