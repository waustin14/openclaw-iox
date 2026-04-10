// Webex REST API client (https://developer.webex.com/docs/api/basics)
import type {
  WebexMessage,
  WebexPerson,
  WebexWebhookRecord,
} from "./types.js";

const WEBEX_API_BASE = "https://webexapis.com/v1";

export type WebexFetch = typeof fetch;

export class WebexApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "WebexApiError";
  }
}

async function webexRequest<T>(params: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  fetcher?: WebexFetch;
}): Promise<T> {
  const fetcher = params.fetcher ?? fetch;
  const url = `${WEBEX_API_BASE}${params.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.token}`,
    Accept: "application/json",
  };
  if (params.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetcher(url, {
    method: params.method,
    headers,
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebexApiError(
      `Webex API ${params.method} ${params.path} failed: ${String(response.status)} ${response.statusText}`,
      response.status,
      text,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/** Fetch the bot's own identity (used for probing and filtering self-messages). */
export async function getWebexSelf(
  token: string,
  fetcher?: WebexFetch,
): Promise<WebexPerson> {
  return webexRequest<WebexPerson>({
    method: "GET",
    path: "/people/me",
    token,
    fetcher,
  });
}

/** Fetch a specific message by ID. */
export async function getWebexMessage(
  token: string,
  messageId: string,
  fetcher?: WebexFetch,
): Promise<WebexMessage> {
  return webexRequest<WebexMessage>({
    method: "GET",
    path: `/messages/${encodeURIComponent(messageId)}`,
    token,
    fetcher,
  });
}

/** Send a text message to a room. */
export async function sendWebexMessage(
  token: string,
  params: { roomId: string; text: string; markdown?: string },
  fetcher?: WebexFetch,
): Promise<WebexMessage> {
  return webexRequest<WebexMessage>({
    method: "POST",
    path: "/messages",
    token,
    body: {
      roomId: params.roomId,
      text: params.text,
      ...(params.markdown ? { markdown: params.markdown } : {}),
    },
    fetcher,
  });
}

/** Send a direct message to a person by email. */
export async function sendWebexDirectMessage(
  token: string,
  params: { toPersonEmail: string; text: string; markdown?: string },
  fetcher?: WebexFetch,
): Promise<WebexMessage> {
  return webexRequest<WebexMessage>({
    method: "POST",
    path: "/messages",
    token,
    body: {
      toPersonEmail: params.toPersonEmail,
      text: params.text,
      ...(params.markdown ? { markdown: params.markdown } : {}),
    },
    fetcher,
  });
}

/** List webhooks registered for this bot. */
export async function listWebexWebhooks(
  token: string,
  fetcher?: WebexFetch,
): Promise<{ items: WebexWebhookRecord[] }> {
  return webexRequest<{ items: WebexWebhookRecord[] }>({
    method: "GET",
    path: "/webhooks",
    token,
    fetcher,
  });
}

/** Register a webhook with Webex. */
export async function createWebexWebhook(
  token: string,
  params: {
    name: string;
    targetUrl: string;
    resource: string;
    event: string;
    secret?: string;
  },
  fetcher?: WebexFetch,
): Promise<WebexWebhookRecord> {
  return webexRequest<WebexWebhookRecord>({
    method: "POST",
    path: "/webhooks",
    token,
    body: {
      name: params.name,
      targetUrl: params.targetUrl,
      resource: params.resource,
      event: params.event,
      ...(params.secret ? { secret: params.secret } : {}),
    },
    fetcher,
  });
}

/** Update an existing webhook (e.g., change targetUrl). */
export async function updateWebexWebhook(
  token: string,
  webhookId: string,
  params: { name: string; targetUrl: string; secret?: string },
  fetcher?: WebexFetch,
): Promise<WebexWebhookRecord> {
  return webexRequest<WebexWebhookRecord>({
    method: "PUT",
    path: `/webhooks/${encodeURIComponent(webhookId)}`,
    token,
    body: {
      name: params.name,
      targetUrl: params.targetUrl,
      ...(params.secret ? { secret: params.secret } : {}),
    },
    fetcher,
  });
}

/** Delete a webhook. */
export async function deleteWebexWebhook(
  token: string,
  webhookId: string,
  fetcher?: WebexFetch,
): Promise<void> {
  return webexRequest<void>({
    method: "DELETE",
    path: `/webhooks/${encodeURIComponent(webhookId)}`,
    token,
    fetcher,
  });
}
