/**
 * What a route handler answers when `requirePermission` throws (W1-13): 401
 * when nobody is signed in, 403 when someone is but lacks the permission. The
 * upload routes answered 401 for both, so a signed-in editor without the
 * permission was told to sign in.
 */
export function isPermissionDenied(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Missing permission:");
}

export function authFailureStatus(err: unknown): 401 | 403 {
  return isPermissionDenied(err) ? 403 : 401;
}
