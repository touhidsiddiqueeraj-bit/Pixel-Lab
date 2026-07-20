/**
 * Figma Import — client-side Figma REST API calls (PAT v1).
 *
 * Uses the user's Personal Access Token (kept in-memory only, never persisted)
 * to fetch file metadata and render flattened PNGs of selected frames.
 *
 * Two endpoints used:
 *   GET /v1/files/:key  —  file metadata (node tree, canvas/frame names)
 *   GET /v1/images/:key —  render selected nodes as PNG images
 */

const FIGMA_API = 'https://api.figma.com/v1';

export interface FigmaFileInfo {
  name: string;
  /** Top-level canvases (pages). Only the first page's children (frames) are imported. */
  frames: FigmaFrameInfo[];
}

export interface FigmaFrameInfo {
  id: string;
  name: string;
  /** Bounding box of the frame in Figma units. Used for display only. */
  rect: { x: number; y: number; w: number; h: number };
}

export interface FigmaImportResult {
  frameName: string;
  /** data URL of the rendered PNG */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Fetch file metadata from Figma and return the list of importable frames.
 */
export async function fetchFigmaFileInfo(
  fileKey: string,
  token: string,
): Promise<FigmaFileInfo> {
  const res = await fetch(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 403) {
    throw new Error('Figma PAT rejected: check that the token has "file_content:read" scope and has access to this file.');
  }
  if (res.status === 404) {
    throw new Error('Figma file not found: check the URL or file key.');
  }
  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const name: string = data.name ?? 'Untitled';
  const frames: FigmaFrameInfo[] = [];

  // Walk the document → first canvas (page) → children (frames/top-level nodes).
  const doc = data.document;
  if (doc?.children?.[0]?.children) {
    for (const child of doc.children[0].children) {
      if (child.type === 'FRAME' || child.type === 'GROUP' || child.type === 'COMPONENT' || child.type === 'INSTANCE') {
        frames.push({
          id: child.id,
          name: child.name ?? 'Untitled',
          rect: child.absoluteBoundingBox ?? { x: 0, y: 0, w: 0, h: 0 },
        });
      }
    }
  }

  return { name, frames };
}

/**
 * Render selected frame nodes as PNG images via Figma's REST API.
 *
 * Returns an array of { frameName, dataUrl, width, height } for each frame.
 */
export async function importFigmaFrames(
  fileKey: string,
  frameIds: string[],
  token: string,
  scale = 2,
  onProgress?: (done: number, total: number) => void,
): Promise<FigmaImportResult[]> {
  if (frameIds.length === 0) return [];

  // Step 1: Get image URLs from Figma
  const idsParam = frameIds.map((id) => encodeURIComponent(id)).join(',');
  const imgRes = await fetch(
    `${FIGMA_API}/images/${encodeURIComponent(fileKey)}?ids=${idsParam}&format=png&scale=${scale}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!imgRes.ok) {
    throw new Error(`Figma images API error: ${imgRes.status} ${imgRes.statusText}`);
  }
  const imgData = await imgRes.json();
  const images: Record<string, string> = imgData.images ?? {};

  // Step 2: Fetch each PNG, decode into canvas, collect results
  const results: FigmaImportResult[] = [];
  for (let i = 0; i < frameIds.length; i++) {
    const id = frameIds[i];
    const url = images[id];
    if (!url) {
      results.push({ frameName: id, dataUrl: '', width: 0, height: 0 });
      continue;
    }

    const img = await fetchImageAsDataUrl(url);
    const { width, height } = await imageDimensions(url);
    results.push({ frameName: id, dataUrl: img, width, height });
    onProgress?.(i + 1, frameIds.length);
  }

  return results;
}

function fetchImageAsDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${url.slice(0, 50)}...`));
    img.src = url;
  });
}

function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to get image dimensions'));
    img.src = url;
  });
}
