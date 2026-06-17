// Image processing utilities: filters, adjustments, background removal

export interface RGB { r: number; g: number; b: number; }

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

// Helper: apply a per-pixel transform function to a canvas context
function applyPixelTransform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: (r: number, g: number, b: number, a: number, x: number, y: number) => [number, number, number, number],
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = transform(data[i], data[i + 1], data[i + 2], data[i + 3], x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// Brightness/Contrast adjustment
export function applyBrightnessContrast(ctx: CanvasRenderingContext2D, w: number, h: number, brightness: number, contrast: number) {
  // brightness: -100 to 100, contrast: -100 to 100
  const b = brightness * 2.55;
  const c = (contrast + 100) / 100;
  const intercept = 128 * (1 - c);
  applyPixelTransform(ctx, w, h, (r, g, bl, a) => [
    Math.max(0, Math.min(255, r * c + intercept + b)),
    Math.max(0, Math.min(255, g * c + intercept + b)),
    Math.max(0, Math.min(255, bl * c + intercept + b)),
    a,
  ]);
}

// Hue / Saturation adjustment
export function applyHueSaturation(ctx: CanvasRenderingContext2D, w: number, h: number, hueShift: number, satShift: number, lightShift: number) {
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const newH = (h + hueShift + 360) % 360;
    const newS = Math.max(0, Math.min(100, s + satShift));
    const newL = Math.max(0, Math.min(100, l + lightShift));
    const rgb = hslToRgb(newH, newS, newL);
    return [rgb.r, rgb.g, rgb.b, a];
  });
}

// Grayscale
export function applyGrayscale(ctx: CanvasRenderingContext2D, w: number, h: number) {
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    return [gray, gray, gray, a];
  });
}

// Invert
export function applyInvert(ctx: CanvasRenderingContext2D, w: number, h: number) {
  applyPixelTransform(ctx, w, h, (r, g, b, a) => [255 - r, 255 - g, 255 - b, a]);
}

// Sepia
export function applySepia(ctx: CanvasRenderingContext2D, w: number, h: number) {
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    const nr = 0.393 * r + 0.769 * g + 0.189 * b;
    const ng = 0.349 * r + 0.686 * g + 0.168 * b;
    const nb = 0.272 * r + 0.534 * g + 0.131 * b;
    return [Math.min(255, nr), Math.min(255, ng), Math.min(255, nb), a];
  });
}

// Threshold
export function applyThreshold(ctx: CanvasRenderingContext2D, w: number, h: number, level: number) {
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = gray >= level ? 255 : 0;
    return [v, v, v, a];
  });
}

// Box blur
export function applyBoxBlur(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number) {
  if (radius < 1) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  const size = radius * 2 + 1;
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const px = Math.max(0, Math.min(w - 1, x + dx));
        const i = (y * w + px) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        count++;
      }
      const di = (y * w + x) * 4;
      dst[di] = r / count; dst[di + 1] = g / count; dst[di + 2] = b / count; dst[di + 3] = a / count;
    }
  }
  // Vertical pass
  const final = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const py = Math.max(0, Math.min(h - 1, y + dy));
        const i = (py * w + x) * 4;
        r += dst[i]; g += dst[i + 1]; b += dst[i + 2]; a += dst[i + 3];
        count++;
      }
      const di = (y * w + x) * 4;
      final[di] = r / count; final[di + 1] = g / count; final[di + 2] = b / count; final[di + 3] = a / count;
    }
  }
  ctx.putImageData(new ImageData(final, w, h), 0, 0);
  void size;
}

// Sharpen (using convolution kernel)
export function applySharpen(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  const k = amount;
  const kernel = [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        if (c === 3) {
          dst[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
          continue;
        }
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const px = Math.max(0, Math.min(w - 1, x + dx));
            const py = Math.max(0, Math.min(h - 1, y + dy));
            sum += src[(py * w + px) * 4 + c] * kernel[(dy + 1) * 3 + (dx + 1)];
          }
        }
        dst[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, sum));
      }
    }
  }
  ctx.putImageData(new ImageData(dst, w, h), 0, 0);
}

// Gaussian-like blur using canvas filter (faster)
export function applyFastBlur(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number) {
  if (radius <= 0) return;
  // Save current image, draw it back with filter
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

// Smart Background Removal: flood-fill from all 4 edges, removing pixels similar to background
// tolerance: 0-100 (higher = more aggressive)
export function autoRemoveBackground(
  sourceCanvas: HTMLCanvasElement,
  tolerance: number = 32,
  edgeFeather: number = 1,
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // visited array
  const visited = new Uint8Array(w * h);
  // result alpha array
  const alpha = new Uint8Array(w * h).fill(255);

  // Helper: color distance squared
  const colorDist2 = (i: number, r: number, g: number, b: number) => {
    const dr = data[i] - r;
    const dg = data[i + 1] - g;
    const db = data[i + 2] - b;
    return dr * dr + dg * dg + db * db;
  };

  // Sample background color from corners
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  const bgSamples: RGB[] = corners.map(([cx, cy]) => {
    const i = (cy * w + cx) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  });

  // tolerance is 0-100, convert to squared distance threshold
  // 100 = very loose (distance ~150 per channel), 0 = exact
  const threshold = (tolerance / 100) * (150 * 150 * 3);

  // BFS queue from all edges
  const queue: number[] = [];
  // Add all edge pixels
  for (let x = 0; x < w; x++) {
    queue.push(x); // top
    queue.push((h - 1) * w + x); // bottom
  }
  for (let y = 0; y < h; y++) {
    queue.push(y * w); // left
    queue.push(y * w + (w - 1)); // right
  }

  // Mark visited and process queue
  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const i = idx * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Check if this pixel is similar to ANY background sample
    let isBg = false;
    for (const sample of bgSamples) {
      if (colorDist2(i, sample.r, sample.g, sample.b) < threshold) {
        isBg = true;
        break;
      }
    }

    if (!isBg) continue;
    alpha[idx] = 0;

    const x = idx % w;
    const y = Math.floor(idx / w);
    // Add neighbors
    if (x > 0 && !visited[idx - 1]) queue.push(idx - 1);
    if (x < w - 1 && !visited[idx + 1]) queue.push(idx + 1);
    if (y > 0 && !visited[idx - w]) queue.push(idx - w);
    if (y < h - 1 && !visited[idx + w]) queue.push(idx + w);
  }

  // Apply feather to alpha edges
  if (edgeFeather > 0) {
    const newAlpha = new Uint8Array(alpha);
    const f = edgeFeather;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (alpha[idx] === 0) continue;
        // Check if near a removed pixel
        let nearRemoved = false;
        let minDist = 999;
        for (let dy = -f; dy <= f; dy++) {
          for (let dx = -f; dx <= f; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            if (alpha[ny * w + nx] === 0) {
              nearRemoved = true;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < minDist) minDist = dist;
            }
          }
        }
        if (nearRemoved) {
          newAlpha[idx] = Math.max(0, Math.min(255, Math.round((minDist / (f + 1)) * 255)));
        }
      }
    }
    alpha.set(newAlpha);
  }

  // Apply alpha to image data
  for (let idx = 0; idx < w * h; idx++) {
    data[idx * 4 + 3] = alpha[idx];
  }

  // Create output canvas
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  octx.putImageData(imageData, 0, 0);
  return out;
}

// Color-based removal: remove all pixels within tolerance of a target color
export function removeColor(
  sourceCanvas: HTMLCanvasElement,
  target: RGB,
  tolerance: number,
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = (tolerance / 100) * (150 * 150 * 3);
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - target.r;
    const dg = data[i + 1] - target.g;
    const db = data[i + 2] - target.b;
    const d2 = dr * dr + dg * dg + db * db;
    if (d2 < threshold) {
      data[i + 3] = 0;
    }
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d')!;
  octx.putImageData(imageData, 0, 0);
  return out;
}

// Generate a thumbnail data URL from a canvas
export function generateThumbnail(canvas: HTMLCanvasElement, maxSize = 48): string {
  const ratio = canvas.width / canvas.height;
  let tw = maxSize, th = maxSize;
  if (ratio > 1) {
    th = maxSize / ratio;
  } else {
    tw = maxSize * ratio;
  }
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.round(tw));
  tmp.height = Math.max(1, Math.round(th));
  const tctx = tmp.getContext('2d')!;
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
  return tmp.toDataURL('image/png');
}

// Convert canvas to data URL
export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

// Create a new blank canvas of given size
export function createBlankCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Composite two canvases (src onto dst at given position with blend mode and opacity)
export function compositeCanvas(
  dst: HTMLCanvasElement,
  src: HTMLCanvasElement,
  x: number,
  y: number,
  opacity: number = 1,
  blendMode: GlobalCompositeOperation = 'source-over',
) {
  const ctx = dst.getContext('2d')!;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = blendMode;
  ctx.drawImage(src, x, y);
  ctx.restore();
}

// Sample color from a canvas at given position
export function sampleColor(canvas: HTMLCanvasElement, x: number, y: number): RGB | null {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}
