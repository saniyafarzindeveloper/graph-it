import { createHash, randomUUID } from "node:crypto";
import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify } from "jose";

const ISSUER = "repository-map-app";
const AUDIENCE = "repository-map-tools";
export const AGENT_CREDENTIAL_TTL_SECONDS = 120;

export interface AgentCredentialClaims {
  analysisId: string;
  organizationId: string;
  userId: string;
  sessionId: string;
}

function getKeyMaterial(purpose: "sign" | "encrypt") {
  const secret = process.env.AGENT_CREDENTIAL_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AGENT_CREDENTIAL_SECRET must be set to a random value of at least 32 bytes.");
  }
  return createHash("sha256").update(`repository-map:${purpose}:v1:`).update(secret).digest();
}

/** Signed JWS wrapped in authenticated encryption so the agent cannot inspect the bound Clerk session. */
export async function mintAgentCredential(claims: AgentCredentialClaims) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + AGENT_CREDENTIAL_TTL_SECONDS;

  const signed = await new SignJWT({
    analysisId: claims.analysisId,
    organizationId: claims.organizationId,
    sessionId: claims.sessionId,
    jti: randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(getKeyMaterial("sign"));

  const token = await new EncryptJWT({ signedCredential: signed })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", cty: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .encrypt(getKeyMaterial("encrypt"));
  return { token, expiresIn: expiresAt - now };
}

export async function verifyAgentCredential(credential: string): Promise<AgentCredentialClaims> {
  const { payload: envelope } = await jwtDecrypt(credential, getKeyMaterial("encrypt"), {
    issuer: ISSUER,
    audience: AUDIENCE,
    maxTokenAge: AGENT_CREDENTIAL_TTL_SECONDS,
    clockTolerance: 5,
  });
  if (typeof envelope.signedCredential !== "string") throw new Error("Malformed agent credential.");

  const { payload } = await jwtVerify(envelope.signedCredential, getKeyMaterial("sign"), {
    issuer: ISSUER,
    audience: AUDIENCE,
    maxTokenAge: AGENT_CREDENTIAL_TTL_SECONDS,
    clockTolerance: 5,
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.analysisId !== "string" ||
    typeof payload.organizationId !== "string" ||
    typeof payload.sessionId !== "string"
  ) throw new Error("Malformed agent credential.");

  return {
    analysisId: payload.analysisId,
    organizationId: payload.organizationId,
    userId: payload.sub,
    sessionId: payload.sessionId,
  };
}
