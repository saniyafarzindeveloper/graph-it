import { createHash, randomUUID } from "node:crypto";
import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify } from "jose";

const ISSUER = "repository-map-app";
const AUDIENCE = "repository-map-tools";
const CREDENTIAL_TTL_SECONDS = 120;

export interface AgentCredentialClaims {
  analysisId: string;
  organizationId: string;
  userId: string;
  databaseAccessToken: string;
}

function getKeyMaterial(purpose: "sign" | "encrypt") {
  const secret = process.env.AGENT_CREDENTIAL_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AGENT_CREDENTIAL_SECRET must be set to a random value of at least 32 bytes.");
  }
  return createHash("sha256").update(`repository-map:${purpose}:v1:`).update(secret).digest();
}

function getDatabaseTokenExpiry(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/** Signed JWS wrapped in authenticated encryption so the agent cannot inspect the embedded RLS token. */
export async function mintAgentCredential(claims: AgentCredentialClaims) {
  const now = Math.floor(Date.now() / 1000);
  const sessionExpiry = getDatabaseTokenExpiry(claims.databaseAccessToken);
  const expiresAt = Math.min(now + CREDENTIAL_TTL_SECONDS, sessionExpiry ?? now + CREDENTIAL_TTL_SECONDS);
  if (expiresAt <= now + 5) throw new Error("The current workspace session expires too soon to start an agent session.");

  const signed = await new SignJWT({
    analysisId: claims.analysisId,
    organizationId: claims.organizationId,
    databaseAccessToken: claims.databaseAccessToken,
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
    maxTokenAge: CREDENTIAL_TTL_SECONDS,
    clockTolerance: 5,
  });
  if (typeof envelope.signedCredential !== "string") throw new Error("Malformed agent credential.");

  const { payload } = await jwtVerify(envelope.signedCredential, getKeyMaterial("sign"), {
    issuer: ISSUER,
    audience: AUDIENCE,
    maxTokenAge: CREDENTIAL_TTL_SECONDS,
    clockTolerance: 5,
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.analysisId !== "string" ||
    typeof payload.organizationId !== "string" ||
    typeof payload.databaseAccessToken !== "string"
  ) throw new Error("Malformed agent credential.");

  return {
    analysisId: payload.analysisId,
    organizationId: payload.organizationId,
    userId: payload.sub,
    databaseAccessToken: payload.databaseAccessToken,
  };
}
