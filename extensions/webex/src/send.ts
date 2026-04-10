import { sendWebexMessage } from "./webex-api.js";
import type { WebexFetch } from "./webex-api.js";

export type WebexSendParams = {
  roomId: string;
  text: string;
  token: string;
  accountId?: string;
  fetcher?: WebexFetch;
};

/** Send a text message to a Webex room. Returns the message ID on success. */
export async function sendMessageWebex(params: WebexSendParams): Promise<string | undefined> {
  const msg = await sendWebexMessage(
    params.token,
    { roomId: params.roomId, text: params.text },
    params.fetcher,
  );
  return msg.id;
}
