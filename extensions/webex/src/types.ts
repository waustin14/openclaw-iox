// Core config types for the Webex channel extension.

export type WebexAccountConfig = {
  name?: string;
  enabled?: boolean;
  botToken?: string | import("openclaw/plugin-sdk/secret-input").SecretInput;
  webhookUrl?: string;
  webhookSecret?: string;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  allowFrom?: (string | number)[];
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: (string | number)[];
  textChunkLimit?: number;
  proxy?: string;
};

export type WebexConfig = WebexAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, Partial<WebexAccountConfig>>;
};

export type ResolvedWebexAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  botToken: string | undefined;
  config: WebexAccountConfig;
};

// Webex API response types

export type WebexPerson = {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  emails?: string[];
  type?: "person" | "bot";
};

export type WebexRoom = {
  id: string;
  title?: string;
  type?: "direct" | "group";
};

export type WebexMessage = {
  id: string;
  roomId: string;
  roomType?: "direct" | "group";
  text?: string;
  markdown?: string;
  personId?: string;
  personEmail?: string;
  created?: string;
  mentionedPeople?: string[];
  files?: string[];
};

export type WebexWebhookEvent = {
  id: string;
  name: string;
  targetUrl: string;
  resource: string;
  event: string;
  orgId?: string;
  createdBy?: string;
  appId?: string;
  ownedBy?: string;
  status?: string;
  actorId?: string;
  data: {
    id: string;
    roomId: string;
    roomType?: "direct" | "group";
    personId?: string;
    personEmail?: string;
    created?: string;
  };
};

export type WebexWebhookRecord = {
  id: string;
  name: string;
  targetUrl: string;
  resource: string;
  event: string;
  status: string;
};
