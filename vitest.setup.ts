// Unit tests never touch a real database, but importing a module that pulls in
// `lib/db` (e.g. `lib/auth` for the pure `can()` helper) evaluates its
// `DATABASE_URL` guard at load time. The postgres client is lazy — it only
// connects on the first query — so a dummy URL lets those modules import
// cleanly without any DB. A test that actually needs data should mock the db.
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/ccms_test";
