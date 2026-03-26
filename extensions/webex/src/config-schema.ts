import {
  AllowFromListSchema,
  DmPolicySchema,
  GroupPolicySchema,
} from "openclaw/plugin-sdk/channel-config-schema";
import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "zod";

export const WebexConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  defaultAccount: z.string().optional(),
  accounts: z.record(z.string(), z.unknown()).optional(),
  botToken: buildSecretInputSchema().optional(),
  webhookUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: AllowFromListSchema,
  groupPolicy: GroupPolicySchema.optional(),
  groupAllowFrom: AllowFromListSchema,
  textChunkLimit: z.number().optional(),
  proxy: z.string().optional(),
});
