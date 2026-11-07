-- 2026-11-07 Price Structure version links (DATA-ONLY, hand-written — never
-- regenerate). A version became a comment + Activity entity (`ps_version`);
-- every price_structure.* audit event is about the version it names, and
-- `writeAudit` links new ones itself (`selfTouches`). This links the ones
-- written before. Idempotent: ON CONFLICT DO NOTHING on the link's unique key.
INSERT INTO "audit_event_entities" ("audit_event_id", "account_id", "entity_type", "entity_id")
SELECT ae."id", ae."account_id", 'ps_version', ae."entity_id"
FROM "audit_events" ae
WHERE ae."entity_type" = 'price_structure'
  AND ae."entity_id" IS NOT NULL
ON CONFLICT DO NOTHING;
