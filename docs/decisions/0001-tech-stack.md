# ADR 0001 — Tech stack

- **Status**: Accepted
- **Date**: 2026-06-14

## Context
We're building a mobile app where a user photographs a meal and gets calories,
macros, and quality nutrients automatically, plus a food-quality score over time.
Team background is JS/TypeScript/React. Launch target: iOS + Android.

## Decision
- **App:** Expo (React Native) + TypeScript + expo-router. One codebase for both
  platforms, fastest iteration, OTA updates, and it reuses the team's JS/React skills.
- **Backend / DB / Auth / Storage:** Supabase (Postgres + Auth + Storage + Edge
  Functions). One managed platform, near-zero ops, row-level security for health data.
- **AI (photo → nutrition):** Claude vision, invoked from a Supabase Edge Function
  that forces a structured JSON response matching `MealAnalysis`.
- **Nutrition reference:** USDA FoodData Central (free) to cross-check known items.

## Why not the alternatives
- **Flutter** — equally capable, but the team knows React, not Dart.
- **Specialized food APIs** (Passio/LogMeal/Nutritionix) — rigid and per-call paid;
  a multimodal LLM is more flexible and customizable for an MVP.
- **Train our own CV model** — far too much effort for worse results than an LLM today.
- **Firebase** instead of Supabase — viable, but we prefer Postgres + SQL + RLS.

## Consequences
- The phone must never hold the AI key — all analysis goes through the Edge Function.
- Calorie estimates from photos are inherently approximate (portion size is the main
  error source); the UX must let users correct estimates.
- Health data + photos → we need a privacy policy before store submission.
