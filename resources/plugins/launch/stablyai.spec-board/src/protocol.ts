// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** The total the worker keeps in storage. */
    'counter.get': { output: { total: number } }
    /** Adds `by` to the stored total and answers the new total. */
    'counter.add': { input: { by: number }; output: { total: number } }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    /** Posted to every open panel after the total changes. */
    'counter.changed': { total: number }
  }
}
