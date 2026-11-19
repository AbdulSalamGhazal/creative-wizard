import { z } from "zod";

/**
 * Personal API tokens for the MCP server (`app/actions/api-token.ts`). Moved
 * here verbatim 2026-11-19 — the same checks and messages.
 */

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name.").max(64, "Too long."),
});

export const apiTokenRevokeSchema = z.object({ tokenId: z.string().uuid() });
