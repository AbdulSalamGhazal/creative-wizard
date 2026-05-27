// Auth.js v5 configuration lives here.
//
// Per docs/tech-spec.md §6:
//  - Google provider, JWT session (30-day rolling)
//  - signIn callback rejects any email whose domain != AUTH_ALLOWED_DOMAIN
//  - First sign-in on an empty users table becomes role=admin; later sign-ins
//    default to role=editor
//  - requireAdmin() throws on insufficient role
//
// To be implemented in the auth task. Intentionally empty in the scaffold.
export {};
