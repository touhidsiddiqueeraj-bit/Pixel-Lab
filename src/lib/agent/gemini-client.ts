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
