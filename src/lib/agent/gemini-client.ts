/**
 * Gemini Client — Thin wrapper around the Gemini API generateContent endpoint
 * with function calling (tool use).
 *
 * SECURITY:
 *   - Calls go DIRECTLY from the browser to `generativelanguage.googleapis.com`.
 *   - The API key is sent ONLY to that Google endpoint (as `?key=` query param,
 *     per Gemini API convention).
 *   - It is NEVER sent to any backend of ours, NEVER logged, NEVER persisted.
 *
 * Network verification (Part 5.7): open DevTools → Network tab while running
 * an agent turn. Every XHR containing the key should be to
 * `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`.
 * No other domain should see the key.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single Part in a Gemini content entry. We only use the variants we need. */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } } // base64 (no data: prefix)
  | {
      functionCall: {
        name: string;
        /** Gemini allows arbitrary JSON args here. */
        args?: Record<string, unknown>;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiToolConfig {
  functionCallingConfig: {
    /** 'AUTO' lets the model decide; 'ANY' forces a tool call. */
    mode: 'AUTO' | 'ANY' | 'NONE';
    /** When mode='ANY', restrict to these allowed function names. */
    allowedFunctionNames?: string[];
  };
}

export interface GeminiGenerateConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  /** Tools the model can call. Gemini accepts an array of tool objects. */
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
  systemInstruction?: string;
}

export interface GeminiResponse {
  candidates: Array<{
    content?: GeminiContent;
    finishReason?: string;
    index?: number;
    safetyRatings?: unknown;
  }>;
  promptFeedback?: unknown;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  public readonly status?: number;
  public readonly body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.body = body;
  }
}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Calls `POST /models/{model}:generateContent`.
 * Use this (non-streaming) variant for tool-calling loops — streaming + tools
 * is more fragile and not needed here.
 */
export async function generateContent(
  opts: GeminiClientOptions,
  contents: GeminiContent[],
  config: GeminiGenerateConfig = {},
): Promise<GeminiResponse> {
  if (!opts.apiKey) {
    throw new GeminiError('No API key set. Enter your Gemini API key first.');
  }
  if (!opts.model) {
    throw new GeminiError('No model selected.');
  }

  const url = `${GEMINI_BASE}/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  // Build the request body per Gemini REST API spec:
  //   - `contents` (top-level)
  //   - `tools` (top-level)
  //   - `toolConfig` (top-level)
  //   - `systemInstruction` (top-level, wrapped as { parts: [{text}] })
  //   - `generationConfig` (top-level, wraps temperature/topP/topK/maxOutputTokens/
  //     stopSequences/responseMimeType)
  // Gemini REJECTS unknown top-level fields with HTTP 400, so we must NOT
  // spread `config` directly into the body.
  const body: Record<string, unknown> = {
    contents,
  };

  if (config.tools) body.tools = config.tools;
  if (config.toolConfig) body.toolConfig = config.toolConfig;
  if (config.systemInstruction) {
    body.systemInstruction = { parts: [{ text: config.systemInstruction }] };
  }

  const genConfig: Record<string, unknown> = {};
  if (typeof config.temperature === 'number') genConfig.temperature = config.temperature;
  if (typeof config.topP === 'number') genConfig.topP = config.topP;
  if (typeof config.topK === 'number') genConfig.topK = config.topK;
  if (typeof config.maxOutputTokens === 'number') genConfig.maxOutputTokens = config.maxOutputTokens;
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
    // Important: do NOT include credentials — we don't want cookies sent to
    // Google, and we don't want any preflight complications.
    credentials: 'omit',
    mode: 'cors',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `Gemini API error (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) message = `Gemini: ${parsed.error.message}`;
    } catch {
      if (text) message += ` — ${text.slice(0, 300)}`;
    }
    throw new GeminiError(message, res.status, text);
  }

  const data = (await res.json()) as GeminiResponse;
  return data;
}

// ---------------------------------------------------------------------------
// Helpers for parsing responses
// ---------------------------------------------------------------------------

/**
 * Extract the assistant's text response (concatenated text parts) from a
 * Gemini response. Returns '' if no text part.
 */
export function extractText(resp: GeminiResponse): string {
  const cand = resp.candidates?.[0];
  if (!cand?.content?.parts) return '';
  return cand.content.parts
    .map((p) => ('text' in p ? p.text : ''))
    .join('')
    .trim();
}

/**
 * Extract any functionCall parts from the response. Returns an array of
 * { name, args }.
 */
export function extractFunctionCalls(
  resp: GeminiResponse,
): { name: string; args: Record<string, unknown> }[] {
  const cand = resp.candidates?.[0];
  if (!cand?.content?.parts) return [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const p of cand.content.parts) {
    if ('functionCall' in p && p.functionCall?.name) {
      calls.push({
        name: p.functionCall.name,
        args: (p.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }
  return calls;
}

/** True if the response contains at least one functionCall part. */
export function hasFunctionCall(resp: GeminiResponse): boolean {
  return extractFunctionCalls(resp).length > 0;
}

// ---------------------------------------------------------------------------
// Image helpers — downscale canvas to base64 for inline image parts
// ---------------------------------------------------------------------------

/**
 * Downscale a source canvas to fit within `maxEdge` px on its longest edge,
 * then return base64 JPEG data (NO data: prefix — Gemini expects raw base64
 * in `inlineData.data`).
 *
 * Why downscale: sending a full-res canvas (e.g. 4000x3000) as base64 would
 * be ~10MB per turn and blow the Gemini context window. 1024px longest edge
 * at JPEG q=0.85 is typically 80-200KB — plenty for the model to "see" the
 * image and pick approximate coordinates.
 */
export function canvasToInlineImagePart(
  source: HTMLCanvasElement,
  maxEdge = 1024,
  quality = 0.85,
): { inlineData: { mimeType: string; data: string } } {
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const tmp = document.createElement('canvas');
  tmp.width = tw;
  tmp.height = th;
  const ctx = tmp.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, tw, th);

  // toDataURL returns "data:image/jpeg;base64,...." — strip the prefix.
  const dataUrl = tmp.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.split(',')[1] ?? '';
  return { inlineData: { mimeType: 'image/jpeg', data: base64 } };
}

// ---------------------------------------------------------------------------
// Vision-based self-evaluation — let the agent "see" its own work
// ---------------------------------------------------------------------------

/**
 * Result of a self-evaluation call. The agent uses this to decide whether
 * to retry the edit (score < threshold) or show the preview to the user.
 */
export interface SelfEvalResult {
  /** Quality score 1-10 (10 = perfect, 1 = garbage). */
  score: number;
  /** Short reasoning (1-2 sentences) explaining the score. */
  reasoning: string;
}

/**
 * Ask the vision model to evaluate the quality of an edit.
 *
 * The agent can't natively "see" the result of its tool calls (it only gets
 * text back from the tools). This function bridges that gap by sending the
 * BEFORE and AFTER images to Gemini Vision along with the user's original
 * request, and asking it to:
 *   1. Rate the edit quality on a 1-10 scale.
 *   2. Explain the rating in 1-2 sentences.
 *   3. Decide whether the edit is good enough to show the user (>= 7) or
 *      should be retried (< 7).
 *
 * The model is also given the agent's stated summary of what it did, so it
 * can judge whether the agent's claim matches what actually happened in the
 * image (catching cases where the agent says "I brightened the sky" but the
 * sky is unchanged, or where the edit went too far and clipped highlights).
 *
 * We use JSON mode (responseMimeType: 'application/json') so we can reliably
 * parse the structured response. If parsing fails, we return a permissive
 * default (score 8, "could not evaluate") so the preview is still shown —
 * better to show a possibly-imperfect edit than to block the user entirely.
 *
 * @param opts API key + model + abort signal
 * @param beforeDataUrl JPEG data URL of the canvas BEFORE the agent's edits
 * @param afterDataUrl JPEG data URL of the canvas AFTER the agent's edits
 * @param userRequest The user's original natural-language request
 * @param agentSummary The agent's own plain-text summary of what it did
 */
export async function evaluateEditQuality(
  opts: GeminiClientOptions,
  beforeDataUrl: string,
  afterDataUrl: string,
  userRequest: string,
  agentSummary: string,
): Promise<SelfEvalResult> {
  // Strip the "data:image/jpeg;base64," prefix to get raw base64 for Gemini's
  // inlineData format.
  const beforeBase64 = beforeDataUrl.split(',')[1] ?? '';
  const afterBase64 = afterDataUrl.split(',')[1] ?? '';

  const prompt = `You are a strict photo-editing QA reviewer. The user asked an AI editing agent to do the following:

USER REQUEST: "${userRequest}"

The AI agent claims it did this:
AGENT SUMMARY: "${agentSummary}"

You are given TWO images:
- Image 1 (BEFORE): the canvas before the agent's edits.
- Image 2 (AFTER): the canvas after the agent's edits.

Evaluate the edit. Be strict but fair. Consider:
1. Did the edit accomplish what the user asked for?
2. Is the edit visible (not a no-op)?
3. Did the edit go too far (e.g. clipped highlights, oversaturated, blown-out)?
4. Did the edit affect the wrong region (e.g. brightened the ground when asked to brighten the sky)?
5. Are there obvious artifacts (halos, banding, blotchy noise)?

Reply with ONLY a JSON object of the form:
{"score": <integer 1-10>, "reasoning": "<one or two short sentences>"}

Scoring guide:
- 10: Perfect — exactly what the user asked for, no artifacts.
- 8-9: Good — minor issues but clearly accomplishes the request.
- 6-7: Acceptable — accomplishes the request but with noticeable issues.
- 4-5: Poor — partial accomplishment or visible artifacts.
- 1-3: Garbage — wrong region, no visible change, or severe artifacts.`;

  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: beforeBase64 } },
        { inlineData: { mimeType: 'image/jpeg', data: afterBase64 } },
      ],
    },
  ];

  // Use a capable vision model for self-eval. The user's selected model might
  // be Flash-Lite (which is fine for the tool-calling loop), but for quality
  // assessment we want a stronger model. We fall back to the user's selected
  // model if the vision model fails — but we always try the vision model first
  // because self-eval quality directly affects whether the user sees garbage.
  const visionModel = pickVisionModel(opts.model);

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.1, // Low temp for consistent scoring
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    },
  };

  const url = `${GEMINI_BASE}/${encodeURIComponent(visionModel)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  let resp: GeminiResponse;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
      credentials: 'omit',
      mode: 'cors',
    });
    if (!res.ok) {
      // If the vision model isn't available (e.g. user's API key doesn't have
      // access to it), fall back to the user's selected model.
      return evaluateEditQualityFallback(opts, beforeDataUrl, afterDataUrl, userRequest, agentSummary);
    }
    resp = (await res.json()) as GeminiResponse;
  } catch {
    // Network error or abort — return a permissive default so we don't block
    // the preview from showing.
    return { score: 8, reasoning: 'Self-evaluation skipped (network error).' };
  }

  const text = extractText(resp);
  return parseSelfEvalResponse(text);
}

/**
 * Fallback: use the user's selected model for self-eval (it may not have
 * vision capability, in which case we can't eval — return permissive default).
 */
async function evaluateEditQualityFallback(
  opts: GeminiClientOptions,
  beforeDataUrl: string,
  afterDataUrl: string,
  userRequest: string,
  agentSummary: string,
): Promise<SelfEvalResult> {
  const beforeBase64 = beforeDataUrl.split(',')[1] ?? '';
  const afterBase64 = afterDataUrl.split(',')[1] ?? '';

  const prompt = `You are a strict photo-editing QA reviewer. The user asked an AI editing agent to do: "${userRequest}". The agent claims: "${agentSummary}". Evaluate the AFTER image vs the BEFORE image. Reply ONLY with JSON: {"score": <1-10>, "reasoning": "<short>"}`;

  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: beforeBase64 } },
        { inlineData: { mimeType: 'image/jpeg', data: afterBase64 } },
      ],
    },
  ];

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    },
  };

  const url = `${GEMINI_BASE}/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
    credentials: 'omit',
    mode: 'cors',
  });

  if (!res.ok) {
    return { score: 8, reasoning: 'Self-evaluation skipped (model unavailable).' };
  }
  const resp = (await res.json()) as GeminiResponse;
  const text = extractText(resp);
  return parseSelfEvalResponse(text);
}

/**
 * Pick the strongest available vision model for self-eval.
 *
 * The user's selected model might be Flash-Lite (chosen for cost during the
 * tool-calling loop), but for self-eval we want the best vision quality we
 * can get. We upgrade Flash-Lite → Flash, and keep Pro as Pro. If the user
 * somehow has an unknown model, we default to Flash for vision.
 */
function pickVisionModel(userModel: string): string {
  if (userModel.includes('pro')) return 'gemini-pro-latest';
  if (userModel.includes('flash-lite')) return 'gemini-flash-latest';
  return userModel || 'gemini-flash-latest';
}

/**
 * Parse the vision model's JSON response into a SelfEvalResult.
 *
 * Defensive: the model might return malformed JSON, extra prose around the
 * JSON, or missing fields. We always return a valid SelfEvalResult — on any
 * parse failure we return a permissive default (score 8) so the preview is
 * shown rather than blocked.
 */
function parseSelfEvalResponse(text: string): SelfEvalResult {
  if (!text || !text.trim()) {
    return { score: 8, reasoning: 'Self-evaluation returned no response.' };
  }
  // Try to extract a JSON object from the text (the model might wrap it in
  // markdown code fences or add prose).
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { score: 8, reasoning: 'Self-evaluation returned non-JSON response.' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    let score = Number(parsed.score);
    if (!Number.isFinite(score)) score = 8;
    score = Math.max(1, Math.min(10, Math.round(score)));
    const reasoning = typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
      ? parsed.reasoning.trim().slice(0, 300)
      : 'Self-evaluation returned no reasoning.';
    return { score, reasoning };
  } catch {
    return { score: 8, reasoning: 'Self-evaluation returned unparseable JSON.' };
  }
}
