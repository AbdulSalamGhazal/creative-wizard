import { z } from "zod";
import { platformEnum } from "@/db/schema";

export const uploadValidateSchema = z.object({
  platform: z.enum(platformEnum),
  // The file itself is read from multipart form-data on the route handler.
});

export const uploadCommitSchema = z.object({
  token: z.string().uuid(),
});

export type UploadValidateInput = z.infer<typeof uploadValidateSchema>;
export type UploadCommitInput = z.infer<typeof uploadCommitSchema>;
