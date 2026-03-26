import { createHmac } from "node:crypto";

/** Returns a validator that checks HMAC-SHA1 signatures from Webex webhooks. */
export function createHmacValidator(secret: string): (body: string, signature: string) => boolean {
  return (body, signature) => {
    const expected = createHmac("sha1", secret).update(body).digest("hex");
    // Constant-time comparison to prevent timing attacks
    if (expected.length !== signature.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  };
}
