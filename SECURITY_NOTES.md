# Security & Privacy Notes — AI Agent Panel

This document is an honest disclosure of the security and privacy properties of
the AI Editing Agent panel added to Pixel Lab. It is intentionally written
without overclaiming.

## TL;DR

- Your Gemini API key lives **only in browser JS memory** for the duration of
  the session. It is never written to `localStorage`, `sessionStorage`, a
  cookie, or any backend of ours.
- Agent calls go **directly** from your browser to
  `https://generativelanguage.googleapis.com`. The key is sent to Google as a
  URL query parameter (`?key=…`), per Gemini API convention.
- Edits proposed by the agent are **previewed offscreen**. Nothing touches the
  real canvas or the undo stack until you click Accept.
- The key is only as safe as this page is free of injected scripts. See
  "Limitations" below.

## API key handling

| Property | Value |
|---|---|
| Storage location | Zustand store slice, in-memory only |
| Written to `localStorage`? | **No** |
| Written to `sessionStorage`? | **No** |
| Written to a cookie? | **No** |
| Sent to any backend of ours? | **No** |
| Sent to Google? | **Yes** — as `?key=` query param on `generateContent` |
| Cleared on tab close? | **Yes** — JS memory is GC'd when the tab closes |
| Clear button? | **Yes** — "Clear" in the API key row, wipes immediately |

The model preference (Flash-Lite / Flash / Pro) **is** persisted to
`localStorage` under the key `pixel-lab-agent-model`. This is a non-secret UI
preference, identical in sensitivity to a theme choice.

### Why a real `<input type="password">`?

The input is a real `<input type="password">` wrapped in a `<form>` with
`autoComplete="current-password"`. If your browser's password manager offers
to save or autofill the key, that is **opt-in to you via your browser** — Pixel
Lab does not control or trigger that behavior, and does not claim credit for
it. If you do save it in your browser's password store, the browser is now
responsible for that storage, not us.

## Network calls

Every network call made by the agent panel is to:

```
https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<YOUR_KEY>
```

No other domain receives your key. To verify:

1. Open DevTools → Network tab.
2. Send a request in the agent panel (e.g. "make it grayscale").
3. Filter requests by `generativelanguage.googleapis.com`.
4. Confirm the only requests containing `?key=` are to that domain.

No analytics, no telemetry, no other third-party calls are introduced by this
feature. (The rest of Pixel Lab may have its own network calls — this note
applies only to the agent panel.)

## Edits and the undo stack

- Every tool call in the agent loop operates on a **cloned offscreen canvas**,
  not the live editor-store.
- The chat panel shows a **before/after preview** when the loop finishes.
- Clicking **Accept** copies the result onto the active layer and pushes a
  single history entry — identical in structure to a manual edit. `Ctrl+Z`
  undoes it normally.
- Clicking **Reject** (or starting a new prompt) discards the preview without
  touching the history stack.

## Limitations (honest disclosure)

The API key lives in JavaScript memory at call time. Any script running in
this origin can read it. Specifically:

- **XSS in this app**: if any code path in Pixel Lab or its dependencies
  introduces an XSS vulnerability, an attacker could exfiltrate the key from
  the Zustand store while it is set. We do not claim the key is "safe" from
  all attacks — it isn't, by definition of being client-side.
- **Malicious browser extension**: a browser extension with page-script
  access on this origin can read the key. This is true of any client-side
  API key flow.
- **Network inspection on the device**: anyone with access to your unlocked
  browser can open DevTools and read the key from memory or from the network
  tab.

If any of these threat models apply to you, do not enter your key in this
panel. Use a server-side proxy instead — which this project explicitly does
not provide, per the "no cloud dependency" design principle in
`ARCHITECTURE.md`.

## What you can do

- Use a separate, restricted Gemini API key (Google AI Studio allows you to
  create per-key restrictions).
- Clear the key immediately after use with the "Clear" button.
- Close the tab when done — this drops the key from memory.
- Do not save the key in your browser's password manager unless you accept
  that responsibility.

## Future extension points

- A server-side proxy that holds the key and signs requests would remove the
  client-side exposure entirely. Out of scope per the project brief.
- A segmentation model (e.g. SAM) for tighter selection masks. Out of scope
  for v1; the existing Magic Wand tolerance/flood-fill is used as a bridge.
