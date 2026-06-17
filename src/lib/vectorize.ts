// Vectorization utilities: convert raster images to SVG paths

export interface VectorizationOptions {
  numColors: number;       // Number of colors to quantize to (2-32)
  smoothing: number;       // 0-100, higher = smoother paths
  detail: number;          // 0-100, higher = more detail (smaller minimum area)
  blurRadius: number;      // 0-5, pre-blur for cleaner edges
}

export interface VectorizationResult {
  svg: string;             // Full SVG document string
  paths: { color: string; d: string }[]; // Individual paths
  width: number;
  height: number;
  palette: string[];       // Color palette used
}

// Color quantization using median cut algorithm
function quantizeColors(pixels: Uint8Array, numColors: number): string[] {
  // Collect unique colors (sample for performance)
  const colorMap = new Map<string, number>();
  const step = Math.max(1, Math.floor(pixels.length / 4 / 10000)); // sample
  for (let i = 0; i < pixels.length; i += 4 * step) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a < 128) continue; // skip transparent
    // Quantize each channel to 5 bits (32 levels) to reduce color space
    const key = `${r >> 3}-${g >> 3}-${b >> 3}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  // Convert to array of {color, count}
  const colors: { r: number; g: number; b: number; count: number }[] = [];
  for (const [key, count] of colorMap) {
    const [r5, g5, b5] = key.split('-').map(Number);
    colors.push({ r: r5 << 3, g: g5 << 3, b: b5 << 3, count });
  }

  // Sort by frequency
  colors.sort((a, b) => b.count - a.count);

  if (colors.length <= numColors) {
    return colors.map(c => rgbToHex(c.r, c.g, c.b));
  }

  // Median cut: recursively split the color space
  const buckets: typeof colors[] = [colors];
  while (buckets.length < numColors) {
    // Find the bucket with the most colors (or widest range)
    let maxRange = 0;
    let maxIdx = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const range = getColorRange(buckets[i]);
      if (range > maxRange) {
        maxRange = range;
        maxIdx = i;
      }
    }
    if (maxRange === 0) break;
    const bucket = buckets[maxIdx];
    // Find the channel with the largest range
    const ranges = getChannelRanges(bucket);
    const channel = ranges.indexOf(Math.max(...ranges));
    // Sort by that channel
    bucket.sort((a, b) => (channel === 0 ? a.r - b.r : channel === 1 ? a.g - b.g : a.b - b.b));
    const mid = Math.floor(bucket.length / 2);
    const left = bucket.slice(0, mid);
    const right = bucket.slice(mid);
    buckets.splice(maxIdx, 1, left, right);
  }

  // Average each bucket
  const palette: string[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    let r = 0, g = 0, b = 0, total = 0;
    for (const c of bucket) {
      r += c.r * c.count;
      g += c.g * c.count;
      b += c.b * c.count;
      total += c.count;
    }
    palette.push(rgbToHex(Math.round(r / total), Math.round(g / total), Math.round(b / total)));
  }
  return palette;
}

function getColorRange(colors: { r: number; g: number; b: number }[]): number {
  const ranges = getChannelRanges(colors);
  return Math.max(...ranges);
}

function getChannelRanges(colors: { r: number; g: number; b: number }[]): [number, number, number] {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const c of colors) {
    rMin = Math.min(rMin, c.r); rMax = Math.max(rMax, c.r);
    gMin = Math.min(gMin, c.g); gMax = Math.max(gMax, c.g);
    bMin = Math.min(bMin, c.b); bMax = Math.max(bMax, c.b);
  }
  return [rMax - rMin, gMax - gMin, bMax - bMin];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

// Map each pixel to the nearest palette color
function mapToPalette(pixels: Uint8Array, palette: string[]): Uint8Array {
  const result = new Uint8Array(pixels.length / 4);
  const paletteRgb = palette.map(hexToRgbTuple);
  for (let i = 0; i < result.length; i++) {
    const pi = i * 4;
    const r = pixels[pi];
    const g = pixels[pi + 1];
    const b = pixels[pi + 2];
    const a = pixels[pi + 3];
    if (a < 128) {
      result[i] = 255; // transparent marker
      continue;
    }
    let minDist = Infinity;
    let bestIdx = 0;
    for (let j = 0; j < paletteRgb.length; j++) {
      const [pr, pg, pb] = paletteRgb[j];
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (dist < minDist) {
        minDist = dist;
        bestIdx = j;
      }
    }
    result[i] = bestIdx;
  }
  return result;
}

// Trace the boundary of a color region using Moore neighborhood algorithm
function traceBoundary(
  labels: Uint8Array,
  width: number,
  height: number,
  targetLabel: number,
  startX: number,
  startY: number,
): { x: number; y: number }[] {
  // Moore neighborhood boundary tracing
  // Directions: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  const isTarget = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return labels[y * width + x] === targetLabel;
  };

  const points: { x: number; y: number }[] = [];
  let cx = startX;
  let cy = startY;
  let dir = 0; // start looking east

  points.push({ x: cx, y: cy });

  const maxSteps = width * height * 4;
  let steps = 0;
  const startKey = `${cx},${cy}`;

  while (steps < maxSteps) {
    steps++;
    // Look around starting from dir-2 (backtrack direction + 1)
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + 6 + i) % 8; // start from previous direction - 2
      const nx = cx + dx[checkDir];
      const ny = cy + dy[checkDir];
      if (isTarget(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = checkDir;
        points.push({ x: cx, y: cy });
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    // Check if we're back to start
    if (cx === startX && cy === startY && points.length > 2) break;
    if (points.length > 3 && `${cx},${cy}` === startKey) break;
  }

  return points;
}

// Simplify a path using Ramer-Douglas-Peucker algorithm
function simplifyPath(points: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
  if (points.length < 3) return points;
  // For closed paths (first point ≈ last point), remove the duplicate last point
  let pts = points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) < 1 && Math.abs(first.y - last.y) < 1) {
    pts = points.slice(0, -1);
  }
  if (pts.length < 3) return points;

  const rdp = (pts: { x: number; y: number }[], start: number, end: number, tol: number, keep: boolean[]) => {
    if (end - start < 2) return;
    let maxDist = 0;
    let maxIdx = 0;
    const sx = pts[start].x, sy = pts[start].y;
    const ex = pts[end].x, ey = pts[end].y;
    const dx = ex - sx, dy = ey - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      // Start and end are the same point; use distance from point to start
      for (let i = start + 1; i < end; i++) {
        const px = pts[i].x, py = pts[i].y;
        const dist = Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
        if (dist > maxDist) {
          maxDist = dist;
          maxIdx = i;
        }
      }
    } else {
      for (let i = start + 1; i < end; i++) {
        const px = pts[i].x, py = pts[i].y;
        // Distance from point to line segment
        const t = ((px - sx) * dx + (py - sy) * dy) / (len * len);
        const closestT = Math.max(0, Math.min(1, t));
        const closestX = sx + closestT * dx;
        const closestY = sy + closestT * dy;
        const dist = Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
        if (dist > maxDist) {
          maxDist = dist;
          maxIdx = i;
        }
      }
    }
    if (maxDist > tol) {
      keep[maxIdx] = true;
      rdp(pts, start, maxIdx, tol, keep);
      rdp(pts, maxIdx, end, tol, keep);
    }
  };

  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  rdp(pts, 0, pts.length - 1, tolerance, keep);

  const result = pts.filter((_, i) => keep[i]);
  // Close the path again if it was closed
  if (pts !== points) {
    result.push({ ...result[0] });
  }
  return result;
}

// Convert a list of points to an SVG path string with smooth curves
function pointsToPath(points: { x: number; y: number }[], smoothing: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.5} ${points[0].y + 0.5}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  // Use quadratic curves for smoothing when smoothing > 0
  if (smoothing > 30) {
    // Smooth with quadratic Bezier curves through midpoints
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      path += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${xc.toFixed(2)} ${yc.toFixed(2)}`;
    }
    path += ` L ${points[points.length - 1].x.toFixed(2)} ${points[points.length - 1].y.toFixed(2)}`;
  } else {
    // Straight lines
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }
  }
  path += ' Z';
  return path;
}

// Box blur for pre-processing (cleans up noise before quantization)
function boxBlur(pixels: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return pixels;
  const result = new Uint8Array(pixels.length);
  const r = Math.max(1, Math.round(radius));
  // Horizontal pass
  const tmp = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0, count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.max(0, Math.min(width - 1, x + dx));
        const i = (y * width + px) * 4;
        rs += pixels[i]; gs += pixels[i + 1]; bs += pixels[i + 2]; as += pixels[i + 3];
        count++;
      }
      const di = (y * width + x) * 4;
      tmp[di] = rs / count; tmp[di + 1] = gs / count; tmp[di + 2] = bs / count; tmp[di + 3] = as / count;
    }
  }
  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const py = Math.max(0, Math.min(height - 1, y + dy));
        const i = (py * width + x) * 4;
        rs += tmp[i]; gs += tmp[i + 1]; bs += tmp[i + 2]; as += tmp[i + 3];
        count++;
      }
      const di = (y * width + x) * 4;
      result[di] = rs / count; result[di + 1] = gs / count; result[di + 2] = bs / count; result[di + 3] = as / count;
    }
  }
  return result;
}

// Main vectorization function
export function vectorizeImage(
  sourceCanvas: HTMLCanvasElement,
  options: VectorizationOptions,
): VectorizationResult {
  const { numColors, smoothing, detail, blurRadius } = options;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  // Cap dimensions for performance
  const maxDim = 600;
  let workW = w, workH = h;
  let scale = 1;
  if (Math.max(w, h) > maxDim) {
    scale = maxDim / Math.max(w, h);
    workW = Math.round(w * scale);
    workH = Math.round(h * scale);
  }

  // Get image data at working resolution
  const workCanvas = document.createElement('canvas');
  workCanvas.width = workW;
  workCanvas.height = workH;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true })!;
  workCtx.imageSmoothingEnabled = true;
  workCtx.imageSmoothingQuality = 'high';
  workCtx.drawImage(sourceCanvas, 0, 0, workW, workH);

  let pixels = workCtx.getImageData(0, 0, workW, workH).data;

  // Pre-blur for cleaner edges
  if (blurRadius > 0) {
    pixels = boxBlur(pixels, workW, workH, blurRadius);
  }

  // Quantize colors
  const palette = quantizeColors(pixels, numColors);
  // Check for transparent pixels (only check alpha channel)
  let hasTransparent = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 128) { hasTransparent = true; break; }
  }
  const labelMap = mapToPalette(pixels, palette);

  // Minimum area threshold based on detail setting
  // detail=100 means keep everything (minArea=1), detail=0 means filter tiny regions
  const minArea = Math.max(1, Math.round((100 - detail) / 100 * 20));

  // For each color, find connected regions and trace boundaries
  const visited = new Uint8Array(workW * workH);
  const paths: { color: string; d: string }[] = [];

  // Scan top-to-bottom, left-to-right for each color region
  for (let y = 0; y < workH; y++) {
    for (let x = 0; x < workW; x++) {
      const idx = y * workW + x;
      if (visited[idx]) continue;
      const label = labelMap[idx];
      if (label === 255) { // transparent
        visited[idx] = 1;
        continue;
      }

      // Flood fill to find region
      const regionPixels: number[] = [];
      const queue = [idx];
      visited[idx] = 1;
      let area = 0;
      // Track the first pixel found (topmost-leftmost) as boundary start
      let startX = x, startY = y;
      while (queue.length > 0) {
        const cur = queue.shift()!;
        regionPixels.push(cur);
        const cx = cur % workW;
        const cy = Math.floor(cur / workW);
        area++;
        // Check 4 neighbors
        if (cx > 0 && !visited[cur - 1] && labelMap[cur - 1] === label) {
          visited[cur - 1] = 1;
          queue.push(cur - 1);
        }
        if (cx < workW - 1 && !visited[cur + 1] && labelMap[cur + 1] === label) {
          visited[cur + 1] = 1;
          queue.push(cur + 1);
        }
        if (cy > 0 && !visited[cur - workW] && labelMap[cur - workW] === label) {
          visited[cur - workW] = 1;
          queue.push(cur - workW);
        }
        if (cy < workH - 1 && !visited[cur + workW] && labelMap[cur + workW] === label) {
          visited[cur + workW] = 1;
          queue.push(cur + workW);
        }
      }

      // Skip tiny regions
      if (area < minArea) continue;

      // Trace boundary starting from the first pixel found (which is topmost-leftmost due to scan order)
      const boundary = traceBoundary(labelMap, workW, workH, label, startX, startY);
      if (boundary.length < 3) {
        // Fallback: use bounding box if boundary tracing failed
        let bMinX = workW, bMinY = workH, bMaxX = 0, bMaxY = 0;
        for (const pi of regionPixels) {
          const px = pi % workW;
          const py = Math.floor(pi / workW);
          bMinX = Math.min(bMinX, px); bMaxX = Math.max(bMaxX, px);
          bMinY = Math.min(bMinY, py); bMaxY = Math.max(bMaxY, py);
        }
        const boxPath = `M ${bMinX} ${bMinY} L ${bMaxX + 1} ${bMinY} L ${bMaxX + 1} ${bMaxY + 1} L ${bMinX} ${bMaxY + 1} Z`;
        const scaledBox = boxPath.replace(/(\d+\.?\d*)/g, (_, n) => (parseFloat(n) / scale).toFixed(2));
        paths.push({ color: palette[label], d: scaledBox });
        continue;
      }

      // Scale boundary points back to original resolution
      const scaledBoundary = boundary.map(p => ({
        x: p.x / scale,
        y: p.y / scale,
      }));

      // Simplify path
      // Use adaptive tolerance based on the path's bounding box size
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const p of scaledBoundary) {
        bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
        bMinY = Math.min(bMinY, p.y); bMaxY = Math.max(bMaxY, p.y);
      }
      const pathSize = Math.max(bMaxX - bMinX, bMaxY - bMinY);
      // tolerance: 0-5% of path size based on smoothing (0% = no simplification, 5% = max)
      const adaptiveTolerance = (smoothing / 100) * 0.05 * pathSize;
      const simplified = simplifyPath(scaledBoundary, adaptiveTolerance);
      if (simplified.length < 3) continue;

      // Convert to SVG path
      const d = pointsToPath(simplified, smoothing);
      if (!d) continue;

      paths.push({ color: palette[label], d });
    }
  }

  // Build SVG
  const svgPaths = paths.map(p => `  <path d="${p.d}" fill="${p.color}" stroke="none" />`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${svgPaths}
</svg>`;

  return {
    svg,
    paths,
    width: w,
    height: h,
    palette: hasTransparent ? [...palette, 'transparent'] : palette,
  };
}

// Render an SVG string to a canvas (for displaying as a layer)
export function svgToCanvas(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
