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
- 🆕 A vision model reviews each edit (BEFORE vs AFTER) before showing it to
  you — this also goes directly to Google's Gemini API, with the same key
  handling as the tool-calling loop.
- 🆕 Your Accept/Reject decisions are recorded to `localStorage` as
  **preference memory** (no images, no API keys — only edit descriptions and
  decisions) so the agent can adapt to your taste over time. You can clear
  this at any time.
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

## 🆕 Preference memory (localStorage)

When you Accept or Reject an edit, Pixel Lab records a `PreferenceEntry` to
`localStorage` under the key `pixel-lab-agent-preferences`. This is what
enables Luna to "learn your taste" over time. Here's exactly what's stored:

| Field | Example | Sensitivity |
|---|---|---|
| `id` | `"k3x8a1b2c"` | Internal only — random ID |
| `ts` | `1784453093000` | Timestamp — same sensitivity as a "last edited" date |
| `userRequest` | `"brighten the sky a lot"` | The natural-language prompt you typed |
| `agentAction` | `"AI: brighten the sky a lot (3 steps)"` | A short label of what the agent did |
| `toolCalls` | `["Selected region by box", "Adjusted exposure", "Deselected"]` | Human-readable labels of the tool calls |
| `decision` | `"accepted"` or `"rejected"` | Your decision |
| `selfScore` | `8` | The agent's own 1–10 quality score for that edit |
| `selfReasoning` | `"Successfully brightened the sky without clipping."` | The agent's own 1–2 sentence reasoning |

**What is NOT stored:**

- ❌ The Gemini API key (lives only in JS memory, never in `localStorage`)
- ❌ Image data, canvas pixels, before/after thumbnails (only the JPEG
  composite is sent to Google during the self-eval call; it's not persisted
  locally)
- ❌ Any personally-identifying information (no user ID, no email, no IP)
- ❌ Any other site's data (preference memory is scoped to Pixel Lab's origin)

**Capacity:** Capped at 50 entries (~100KB max). Older entries are pruned on
append.

**Clearing:** Open the Luna panel → click the brain icon (top-right of the
panel, shows your accept count / total) → "Clear memory" button. This wipes
the `localStorage` key immediately.

**Visibility:** You can inspect the entries at any time via DevTools →
Application → Local Storage → `pixel-lab-agent-preferences`. The data is plain
JSON, not encrypted — there's nothing secret in it to encrypt.

### Why is preference memory in localStorage but the API key isn't?

The API key is a **secret credential** — anyone who has it can make API calls
as you and bill them to your account. So it stays in JS memory only and is
wiped when the tab closes.

Preference memory is **not a secret** — it's a record of which edits you liked.
It's identical in sensitivity to a "recently viewed items" list on an e-
commerce site. Storing it in `localStorage` means it survives a page refresh,
so Luna can adapt across sessions without you having to retrain it each time.

If you'd prefer Luna to NOT remember across sessions, just click "Clear
memory" before closing the tab, or use your browser's "clear site data"
feature.

## Network calls

Every network call made by the agent panel is to:

```
https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<YOUR_KEY>
```

🆕 This includes the **self-evaluation call** — when the agent reviews its own
edit, that's a separate `generateContent` call to the same Google endpoint,
with the same key handling. The self-eval call uses a stronger vision model
than the tool-calling loop (Flash-Lite → Flash for vision; Pro stays Pro) for
accurate quality assessment. If the vision model is unavailable for your key,
we fall back to your selected model; if that also fails, we return a
permissive default (score 8) so the preview is never blocked.

No other domain receives your key. To verify:

1. Open DevTools → Network tab.
2. Send a request in the agent panel (e.g. "make it grayscale").
3. Filter requests by `generativelanguage.googleapis.com`.
4. Confirm the only requests containing `?key=` are to that domain. You'll
   see two kinds of calls during a typical run:
   - The tool-calling loop (1–8 calls, depending on how many tools the agent
     uses)
   - The self-eval call (1 per attempt, so 1–3 calls depending on retry
     behavior)

No analytics, no telemetry, no other third-party calls are introduced by this
feature. (The rest of Pixel Lab may have its own network calls — this note
applies only to the agent panel.)

## Edits and the undo stack

- Every tool call in the agent loop operates on a **cloned offscreen canvas**,
  not the live editor-store.
- The chat panel shows a **before/after preview** when the loop finishes.
  🆕 The agent's self-eval score (1–10) and reasoning are displayed above the
  Accept/Reject buttons.
- 🆕 If the self-eval score is below 7, the agent **automatically retries** the
  edit with feedback (up to 2 retries). You only see the preview when the
  agent is confident enough, or when it exhausts retries (in which case it
  shows the best-scoring attempt).
- Clicking **Accept** copies the result onto the active layer and pushes a
  single history entry — identical in structure to a manual edit. `Ctrl+Z`
  undoes it normally. 🆕 The accept is also recorded to preference memory.
- Clicking **Reject** (or starting a new prompt) discards the preview without
  touching the history stack. 🆕 The reject is also recorded to preference
  memory.

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
- **Preference memory visibility**: the preference entries in `localStorage`
  are visible to anyone with access to your browser's DevTools. They contain
  only edit descriptions and decisions (no secrets), but if you'd rather not
  leave a record of what you asked the agent to do, use "Clear memory" before
  closing the tab.

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
- 🆕 Use "Clear memory" in the preference panel if you don't want a record
  of your accept/reject history to persist across sessions.
- 🆕 Use your browser's "clear site data" feature to wipe everything
  (preference memory + model preference) at once.

## Future extension points

- A server-side proxy that holds the key and signs requests would remove the
  client-side exposure entirely. Out of scope per the project brief.
- A segmentation model (e.g. SAM) for tighter selection masks. Out of scope
  for v1; the existing Magic Wand tolerance/flood-fill is used as a bridge.
- 🆕 A tunable self-eval threshold (currently fixed at 7/10) would let
  advanced users make Luna stricter or more permissive.
- 🆕 An opt-out for preference memory (currently always-on, but clearable).
  Could be a checkbox in the preference panel if a user wants ephemeral-only
  mode.
