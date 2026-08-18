-- Wood construction potential, from Tonttilistaus.xlsx (Aihiot sheet, "Wood /Concrete" column).
-- true = Wood (Puu), false = Betoni, null = unknown.
-- Applied 2026-08-18 via the Supabase dashboard (boolean column named "Wood").
-- The app's API maps it to material: 'Puu' | 'Betoni' | '' in app/api/plots/route.ts.

ALTER TABLE plots ADD COLUMN IF NOT EXISTS "Wood" boolean;
