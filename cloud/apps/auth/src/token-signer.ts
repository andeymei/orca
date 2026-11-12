import { SignJWT, jwtVerify } from 'jose'
import type { SigningKey } from './signing-key.js'

export type AccessTokenClaims = {
  userId: string
  cloudProfileId: string
  sessionId: string
  orgId?: string
}

export type TokenSigner = {
  mintAccessToken(input: {
    userId: string
    cloudProfileId: string
    sessionId: string
    orgId?: string
    ttlMs: number
    audience: string
  }): Promise<{ token: string; expiresAt: number }>
  verifyAccessToken(token: string, audience: string): Promise<AccessTokenClaims | null>
  mintRelayToken(input: {
    userId: string
    cloudProfileId: string
    orgId?: string
    relayHostId: string
    ttlMs: number
    audience: string
  }): Promise<{ token: string; expiresAt: number }>
}

export function createTokenSigner(key: SigningKey, issuer: string): TokenSigner {
  return {
    async mintAccessToken(input) {
      const expiresAt = Date.now() + input.ttlMs
      const token = await new SignJWT({
        prof: input.cloudProfileId,
        sid: input.sessionId,
        ...(input.orgId === undefined ? {} : { org: input.orgId })
      })
        .setProtectedHeader({ alg: 'ES256', kid: key.kid })
        .setIssuer(issuer)
        .setAudience(input.audience)
        .setSubject(input.userId)
        .setIssuedAt()
        .setExpirationTime(Math.floor(expiresAt / 1000))
        .sign(key.privateKey)
      return { token, expiresAt }
    },

    async verifyAccessToken(token, audience) {
      try {
        const { payload } = await jwtVerify(token, key.publicKey, {
          issuer,
          audience,
          algorithms: ['ES256']
        })
        if (typeof payload.sub !== 'string' || typeof payload.prof !== 'string') {
          return null
        }
        if (typeof payload.sid !== 'string') {
          return null
        }
        return {
          userId: payload.sub,
          cloudProfileId: payload.prof,
          sessionId: payload.sid,
          ...(typeof payload.org === 'string' ? { orgId: payload.org } : {})
        }
      } catch {
        return null
      }
    },

    async mintRelayToken(input) {
      const expiresAt = Date.now() + input.ttlMs
      const token = await new SignJWT({
        prof: input.cloudProfileId,
        relayHostId: input.relayHostId,
        purpose: 'host-control',
        ...(input.orgId === undefined ? {} : { org: input.orgId })
      })
        .setProtectedHeader({ alg: 'ES256', kid: key.kid })
        .setIssuer(issuer)
        .setAudience(input.audience)
        .setSubject(input.userId)
        .setIssuedAt()
        .setExpirationTime(Math.floor(expiresAt / 1000))
        .sign(key.privateKey)
      return { token, expiresAt }
    }
  }
}
