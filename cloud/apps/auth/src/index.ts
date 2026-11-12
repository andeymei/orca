import { createAdaptorServer } from '@hono/node-server'
import { createAuthApp } from './app.js'
import { openAuthDatabase } from './auth-database.js'
import { ensureBootstrapUser } from './bootstrap-user.js'
import { loadAuthConfig } from './config.js'
import { loadOrCreateSessionSecret } from './session-secret.js'
import { loadSigningKey } from './signing-key.js'
import { createTokenSigner } from './token-signer.js'

const config = loadAuthConfig()
const database = await openAuthDatabase({
  ...(config.databaseUrl === undefined ? {} : { databaseUrl: config.databaseUrl }),
  dataDir: config.dataDir,
  poolMax: config.databasePoolMax,
  applicationName: 'orca-auth'
})
const signingKey = await loadSigningKey({
  ...(config.signingKeyPem === undefined ? {} : { pem: config.signingKeyPem }),
  path: config.signingKeyPath
})
const sessionSecret = loadOrCreateSessionSecret({
  ...(config.sessionCookieSecret === undefined ? {} : { provided: config.sessionCookieSecret }),
  path: `${config.dataDir}/orca-auth-session-secret`
})
const signer = createTokenSigner(signingKey, config.issuer)
await ensureBootstrapUser(database, config)

const app = createAuthApp({ config, database, signer, signingKey, sessionSecret })
const server = createAdaptorServer(app)

server.listen(config.port, () => {
  console.log(`[orca-auth] listening on ${config.publicUrl} (port ${config.port})`)
})

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 9_000)
  deadline.unref()
  const connections = new Promise<void>((resolve) => server.close(() => resolve()))
  void connections
    .then(async () => {
      await database.close()
      clearTimeout(deadline)
    })
    .catch(() => {
      console.warn(JSON.stringify({ event: 'orca_auth_shutdown_failed' }))
      process.exitCode = 1
    })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
