-- Plan 0031: profile health info (food allergies + medical/physical conditions).
--
-- Four columns on `profiles`. The booleans default false so every existing row
-- backfills to "no allergies / no conditions" with no data migration. The notes
-- are optional free text, capped at 500 code points (mirrors the client
-- HEALTH_NOTE_MAX + the maxLength on the input), and — defense-in-depth for health
-- data at rest — a note MUST be null whenever its flag is false, so no orphaned
-- health free text can ever linger behind a "No".
--
-- RLS: none needed. `profiles` already has owner-scoped RLS for all verbs
-- (auth.uid() = id, initial_schema); these columns live on that same row and
-- inherit it. No new policy, index, or trigger.

alter table public.profiles
  add column if not exists has_allergies boolean not null default false,
  add column if not exists allergies_note text,
  add column if not exists has_conditions boolean not null default false,
  add column if not exists conditions_note text;

alter table public.profiles
  add constraint profiles_allergies_note_len
    check (allergies_note is null or char_length(allergies_note) <= 500),
  add constraint profiles_conditions_note_len
    check (conditions_note is null or char_length(conditions_note) <= 500),
  -- A note may only exist when its flag is set (clears stale health text on "No").
  add constraint profiles_allergies_note_gated
    check (has_allergies or allergies_note is null),
  add constraint profiles_conditions_note_gated
    check (has_conditions or conditions_note is null);
