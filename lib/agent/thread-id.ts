import { createHmac } from "node:crypto";

/** Create an opaque service thread ID scoped to one user, organization, and analysis. */
export function getScopedAgentThreadId(input: {
  analysisId: string;
  organizationId: string;
  userId: string;
  conversationId: string;
}) {
  const secret = process.env.AGENT_CREDENTIAL_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AGENT_CREDENTIAL_SECRET must be set to a random value of at least 32 bytes.");
  }
  const bytes = createHmac("sha256", secret)
    .update("repository-map-thread:v1:")
    .update(JSON.stringify([input.organizationId, input.userId, input.analysisId, input.conversationId]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
