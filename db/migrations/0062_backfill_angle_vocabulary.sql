-- 2026-10-26 angle vocabulary backfill (DATA-ONLY, hand-written — never
-- regenerate; `drizzle-kit generate` has nothing to say about data).
--
-- Until this date an angle typed on a creative (the detail dropdown, the New
-- creative form, the bulk import) was written to `creative_angles` ONLY. The
-- managed vocabulary (`angles`, the Library's Angles tab) only ever grew
-- through that tab — or the dev seed, which is why Urjwan's tab looked
-- complete and a fresh brand's (Mesbah) said "No angles yet" while its
-- creatives carried angles. The code now writes the vocabulary row in the same
-- transaction as every assignment (db/queries/angles.ts `addToVocabulary`);
-- this folds the assignments that predate it in, per brand. Idempotent.
INSERT INTO "angles" ("account_id", "name")
SELECT DISTINCT c."account_id", ca."angle"
FROM "creative_angles" ca
JOIN "creatives" c ON c."id" = ca."creative_id"
ON CONFLICT ("account_id", "name") DO NOTHING;
