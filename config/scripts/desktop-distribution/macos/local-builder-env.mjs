// The environment a local electron-builder run needs.
//
// A local build has no signing identity, and on this machine it usually sits behind a
// filtering proxy. electron-builder reaches GitHub for the Electron runtime and its own
// toolset, so the proxy has to reach the child process in every form the downloaders look
// at: builder-util's got honours HTTP(S)_PROXY, and @electron/get only routes undici
// through it when it is asked to.
export function redactProxy(proxyUrl) {
  try {
    const url = new URL(proxyUrl)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return '<unparsable proxy url>'
  }
}

/**
 * Build the environment for a local electron-builder run.
 *
 * @param {NodeJS.ProcessEnv} [environment] the environment to derive from
 * @returns {{ env: NodeJS.ProcessEnv, proxy: string | null }} the child environment and the
 *   proxy it routes through, if any
 */
export function localBuilderEnv(environment = process.env) {
  const proxy =
    environment.ORCA_BUILD_PROXY ?? environment.HTTPS_PROXY ?? environment.https_proxy ?? null
  if (!proxy) {
    return { env: { ...environment }, proxy: null }
  }
  const noProxy = environment.NO_PROXY ?? 'localhost,127.0.0.1,::1'
  return {
    proxy,
    env: {
      ...environment,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      http_proxy: proxy,
      https_proxy: proxy,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      // @electron/get routes undici through the proxy only when asked to.
      ELECTRON_GET_USE_PROXY: 'true',
      // @electron/get v3 bootstraps global-agent from its own prefixed variables.
      GLOBAL_AGENT_HTTP_PROXY: proxy,
      GLOBAL_AGENT_HTTPS_PROXY: proxy,
      GLOBAL_AGENT_NO_PROXY: noProxy
    }
  }
}
