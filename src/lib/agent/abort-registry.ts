/**
 * Abort registry — tracks the AbortControllers of in-flight agent runs so
 * `cancelRun()` / `clearApiKey()` can actually cancel the in-flight HTTP
 * request to Gemini.
 *
 * Lives in its own module (imported by both the store and the runner) to
 * avoid a circular import: agent-runner imports agent-store, so the store
 * cannot import the runner.
 *
 * Before this existed, `cancelToken` was bumped on cancel but the fetch kept
 * running to completion — the run kept spending tokens/latency after the UI
 * said "cancelled".
 */

const activeControllers = new Set<AbortController>();

export function registerAbortController(ctrl: AbortController): void {
  activeControllers.add(ctrl);
}

export function unregisterAbortController(ctrl: AbortController): void {
  activeControllers.delete(ctrl);
}

/** Abort every in-flight agent fetch. Called on cancel / key clear / chat clear. */
export function abortAllAgentRequests(): void {
  for (const ctrl of activeControllers) {
    try {
      ctrl.abort();
    } catch {
      // Already aborted — ignore.
    }
  }
  activeControllers.clear();
}
