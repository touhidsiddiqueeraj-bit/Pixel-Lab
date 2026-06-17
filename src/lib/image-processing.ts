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

// ============================================================================
// AUTO UNBLUR - Smart deconvolution-based sharpening
// Combines unsharp masking with edge-preserving enhancement
// strength: 0-100 (default 50)
// radius: 0-5 (default 1.5) - blur radius for unsharp mask
// threshold: 0-50 (default 0) - minimum delta required for sharpening
// ============================================================================

export function autoUnblur(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength: number = 50,
  radius: number = 1.5,
  threshold: number = 0,
) {
  if (strength <= 0) return;

  // Step 1: Create a blurred copy using box blur approximation
  const original = ctx.getImageData(0, 0, w, h);
  const blurred = new Uint8ClampedArray(original.data);

  // Box blur with given radius
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? blurred : blurred;
    const tmp = new Uint8ClampedArray(src);
    // Horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rs = 0, gs = 0, bs = 0, count = 0;
        for (let dx = -r; dx <= r; dx++) {
          const px = Math.max(0, Math.min(w - 1, x + dx));
          const i = (y * w + px) * 4;
          rs += src[i]; gs += src[i + 1]; bs += src[i + 2];
          count++;
        }
        const di = (y * w + x) * 4;
        tmp[di] = rs / count; tmp[di + 1] = gs / count; tmp[di + 2] = bs / count;
        tmp[di + 3] = src[di + 3];
      }
    }
    // Vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rs = 0, gs = 0, bs = 0, count = 0;
        for (let dy = -r; dy <= r; dy++) {
          const py = Math.max(0, Math.min(h - 1, y + dy));
          const i = (py * w + x) * 4;
          rs += tmp[i]; gs += tmp[i + 1]; bs += tmp[i + 2];
          count++;
        }
        const di = (y * w + x) * 4;
        blurred[di] = rs / count; blurred[di + 1] = gs / count; blurred[di + 2] = bs / count;
        blurred[di + 3] = tmp[di + 3];
      }
    }
  }

  // Step 2: Unsharp mask = original + amount * (original - blurred)
  // With threshold to avoid sharpening noise
  const amount = strength / 50; // 0-2
  const data = original.data;
  const result = new Uint8ClampedArray(data.length);
  const threshSq = threshold * threshold * 3;

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - blurred[i];
    const dg = data[i + 1] - blurred[i + 1];
    const db = data[i + 2] - blurred[i + 2];
    const d2 = dr * dr + dg * dg + db * db;
    if (d2 < threshSq) {
      // Below threshold, keep original
      result[i] = data[i];
      result[i + 1] = data[i + 1];
      result[i + 2] = data[i + 2];
      result[i + 3] = data[i + 3];
    } else {
      result[i] = Math.max(0, Math.min(255, data[i] + amount * dr));
      result[i + 1] = Math.max(0, Math.min(255, data[i + 1] + amount * dg));
      result[i + 2] = Math.max(0, Math.min(255, data[i + 2] + amount * db));
      result[i + 3] = data[i + 3];
    }
  }

  // Step 3: Edge enhancement - boost high-frequency edges
  // Use Sobel-like edge detection and add edges back
  const edgeEnhance = strength / 100; // 0-1
  const edgeData = new Uint8ClampedArray(result);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      // Sobel X
      const gx =
        -1 * result[((y - 1) * w + (x - 1)) * 4] +
        2 * result[(y * w + (x - 1)) * 4] +
        -1 * result[((y + 1) * w + (x - 1)) * 4] +
        1 * result[((y - 1) * w + (x + 1)) * 4] +
        2 * result[(y * w + (x + 1)) * 4] +
        1 * result[((y + 1) * w + (x + 1)) * 4];
      const gy =
        -1 * result[((y - 1) * w + (x - 1)) * 4] +
        2 * result[((y - 1) * w + x) * 4] +
        -1 * result[((y - 1) * w + (x + 1)) * 4] +
        1 * result[((y + 1) * w + (x - 1)) * 4] +
        2 * result[((y + 1) * w + x) * 4] +
        1 * result[((y + 1) * w + (x + 1)) * 4];
      const edgeMag = Math.sqrt(gx * gx + gy * gy);
      const boost = Math.min(255, edgeMag * edgeEnhance * 0.5);
      edgeData[i] = Math.max(0, Math.min(255, result[i] + boost));
      edgeData[i + 1] = Math.max(0, Math.min(255, result[i + 1] + boost));
      edgeData[i + 2] = Math.max(0, Math.min(255, result[i + 2] + boost));
    }
  }

  ctx.putImageData(new ImageData(edgeData, w, h), 0, 0);
}

// ============================================================================
// ADDITIONAL FILTERS
// ============================================================================

// Add Gaussian noise (film grain effect)
export function addNoise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    const n = (Math.random() - 0.5) * amount * 2.55;
    return [
      Math.max(0, Math.min(255, r + n)),
      Math.max(0, Math.min(255, g + n)),
      Math.max(0, Math.min(255, b + n)),
      a,
    ];
  });
}

// Median filter for noise reduction (preserves edges better than blur)
export function medianDenoise(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number = 1) {
  if (radius < 1) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  const r = radius;
  const size = (2 * r + 1) * (2 * r + 1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        const vals = new Array(size);
        let k = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const px = Math.max(0, Math.min(w - 1, x + dx));
            const py = Math.max(0, Math.min(h - 1, y + dy));
            vals[k++] = src[(py * w + px) * 4 + c];
          }
        }
        vals.sort((a, b) => a - b);
        dst[(y * w + x) * 4 + c] = vals[Math.floor(size / 2)];
      }
      dst[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
    }
  }
  ctx.putImageData(new ImageData(dst, w, h), 0, 0);
}

// Vignette (darken edges)
export function applyVignette(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, size: number) {
  // amount: 0-100, size: 0-100 (0 = tight, 100 = wide)
  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const innerRadius = (size / 100) * maxDist;
  const outerRadius = maxDist;
  applyPixelTransform(ctx, w, h, (r, g, b, a, x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= innerRadius) return [r, g, b, a];
    const t = Math.min(1, (dist - innerRadius) / (outerRadius - innerRadius));
    const factor = 1 - (amount / 100) * t;
    return [r * factor, g * factor, b * factor, a];
  });
}

// Edge detection (Sobel)
export function applyEdgeDetect(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  // Convert to grayscale first
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[y * w + (x - 1)] - gray[(y + 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] + 2 * gray[y * w + (x + 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      const di = (y * w + x) * 4;
      dst[di] = mag; dst[di + 1] = mag; dst[di + 2] = mag; dst[di + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(dst, w, h), 0, 0);
}

// Emboss filter
export function applyEmboss(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);
  const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[((y + dy) * w + (x + dx)) * 4 + c] * kernel[(dy + 1) * 3 + (dx + 1)];
          }
        }
        const v = Math.max(0, Math.min(255, sum + 128));
        dst[(y * w + x) * 4 + c] = v;
      }
      dst[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
    }
  }
  ctx.putImageData(new ImageData(dst, w, h), 0, 0);
}

// Pixelate / Mosaic
export function applyPixelate(ctx: CanvasRenderingContext2D, w: number, h: number, blockSize: number) {
  if (blockSize < 2) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let by = 0; by < h; by += blockSize) {
    for (let bx = 0; bx < w; bx += blockSize) {
      // Sample center pixel
      const cx = Math.min(w - 1, bx + Math.floor(blockSize / 2));
      const cy = Math.min(h - 1, by + Math.floor(blockSize / 2));
      const ci = (cy * w + cx) * 4;
      const r = data[ci], g = data[ci + 1], b = data[ci + 2];
      // Fill block
      for (let y = by; y < Math.min(h, by + blockSize); y++) {
        for (let x = bx; x < Math.min(w, bx + blockSize); x++) {
          const i = (y * w + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// Posterize - reduce number of colors
export function applyPosterize(ctx: CanvasRenderingContext2D, w: number, h: number, levels: number) {
  const step = 255 / (levels - 1);
  applyPixelTransform(ctx, w, h, (r, g, b, a) => [
    Math.round(Math.round(r / step) * step),
    Math.round(Math.round(g / step) * step),
    Math.round(Math.round(b / step) * step),
    a,
  ]);
}

// Color temperature adjustment (warm = +, cool = -)
export function applyColorTemperature(ctx: CanvasRenderingContext2D, w: number, h: number, temp: number) {
  // temp: -100 (cool) to 100 (warm)
  const rShift = temp * 0.8;
  const bShift = -temp * 0.8;
  applyPixelTransform(ctx, w, h, (r, g, b, a) => [
    Math.max(0, Math.min(255, r + rShift)),
    g,
    Math.max(0, Math.min(255, b + bShift)),
    a,
  ]);
}

// ============================================================================
// TRANSFORM OPERATIONS
// ============================================================================

// Rotate the entire image by 90, 180, or 270 degrees
export function rotateCanvas(sourceCanvas: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement {
  let newW: number, newH: number;
  if (degrees === 90 || degrees === 270) {
    newW = sourceCanvas.height;
    newH = sourceCanvas.width;
  } else {
    newW = sourceCanvas.width;
    newH = sourceCanvas.height;
  }
  const out = createBlankCanvas(newW, newH);
  const ctx = out.getContext('2d')!;
  ctx.save();
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  ctx.restore();
  return out;
}

// Flip canvas horizontally or vertically
export function flipCanvas(sourceCanvas: HTMLCanvasElement, horizontal: boolean): HTMLCanvasElement {
  const out = createBlankCanvas(sourceCanvas.width, sourceCanvas.height);
  const ctx = out.getContext('2d')!;
  ctx.save();
  if (horizontal) {
    ctx.translate(sourceCanvas.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, sourceCanvas.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
  return out;
}

// Scale canvas to new dimensions
export function scaleCanvas(sourceCanvas: HTMLCanvasElement, newW: number, newH: number): HTMLCanvasElement {
  const out = createBlankCanvas(newW, newH);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, newW, newH);
  return out;
}

// ============================================================================
// SELECTION OPERATIONS
// ============================================================================

// Feather selection edges by a given radius
export function featherSelection(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  if (radius <= 0) return mask;
  const w = mask.width, h = mask.height;
  const ctx = mask.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  // Box blur the alpha channel
  const r = Math.max(1, Math.round(radius));
  const tmp = new Uint8ClampedArray(data);
  // Horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.max(0, Math.min(w - 1, x + dx));
        sum += tmp[(y * w + px) * 4 + 3];
        count++;
      }
      data[(y * w + x) * 4 + 3] = sum / count;
    }
  }
  // Vertical
  const tmp2 = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const py = Math.max(0, Math.min(h - 1, y + dy));
        sum += tmp2[(py * w + x) * 4 + 3];
        count++;
      }
      data[(y * w + x) * 4 + 3] = sum / count;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return mask;
}

// ============================================================================
// HEALING BRUSH - content-aware spot removal
// ============================================================================

export function healSpot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  centerX: number,
  centerY: number,
  radius: number,
  sourceX: number,
  sourceY: number,
) {
  // Sample source area and blend with destination using Poisson-like blending (simplified)
  const r = Math.max(1, Math.round(radius));
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const sx = Math.round(sourceX);
  const sy = Math.round(sourceY);
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);

  // Copy source region into destination with soft circular mask
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      // Soft falloff
      const alpha = Math.pow(1 - dist / r, 2);
      const dIdx = ((cy + dy) * w + (cx + dx)) * 4;
      const sIdx = ((sy + dy) * w + (sx + dx)) * 4;
      if (dIdx < 0 || dIdx >= data.length || sIdx < 0 || sIdx >= data.length) continue;
      // Blend source into destination, also average with surrounding destination pixels for healing
      const neighbors = [
        ((cy + dy - 1) * w + (cx + dx)) * 4,
        ((cy + dy + 1) * w + (cx + dx)) * 4,
        ((cy + dy) * w + (cx + dx - 1)) * 4,
        ((cy + dy) * w + (cx + dx + 1)) * 4,
      ];
      let nr = 0, ng = 0, nb = 0, ncount = 0;
      for (const ni of neighbors) {
        if (ni >= 0 && ni < data.length) {
          nr += data[ni]; ng += data[ni + 1]; nb += data[ni + 2]; ncount++;
        }
      }
      const avgR = nr / ncount;
      const avgG = ng / ncount;
      const avgB = nb / ncount;
      // Compute source's offset from its local average
      const sNeighbors = [
        ((sy + dy - 1) * w + (sx + dx)) * 4,
        ((sy + dy + 1) * w + (sx + dx)) * 4,
        ((sy + dy) * w + (sx + dx - 1)) * 4,
        ((sy + dy) * w + (sx + dx + 1)) * 4,
      ];
      let sAvgR = 0, sAvgG = 0, sAvgB = 0, sCount = 0;
      for (const ni of sNeighbors) {
        if (ni >= 0 && ni < data.length) {
          sAvgR += data[ni]; sAvgG += data[ni + 1]; sAvgB += data[ni + 2]; sCount++;
        }
      }
      sAvgR /= sCount; sAvgG /= sCount; sAvgB /= sCount;
      // Healing: blend source's structure (delta from its local avg) into destination's local avg
      const sR = data[sIdx];
      const sG = data[sIdx + 1];
      const sB = data[sIdx + 2];
      const healedR = avgR + (sR - sAvgR);
      const healedG = avgG + (sG - sAvgG);
      const healedB = avgB + (sB - sAvgB);
      data[dIdx] = Math.max(0, Math.min(255, data[dIdx] * (1 - alpha) + healedR * alpha));
      data[dIdx + 1] = Math.max(0, Math.min(255, data[dIdx + 1] * (1 - alpha) + healedG * alpha));
      data[dIdx + 2] = Math.max(0, Math.min(255, data[dIdx + 2] * (1 - alpha) + healedB * alpha));
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ============================================================================
// LIQUIFY TOOLS - push, pucker, bloat, twirl
// ============================================================================

export type LiquifyOp = 'push' | 'pucker' | 'bloat' | 'twirl' | 'reconstruct';

export function liquify(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  centerX: number,
  centerY: number,
  radius: number,
  strength: number,
  op: LiquifyOp,
  direction: { x: number; y: number } = { x: 0, y: 0 },
) {
  const r = Math.max(2, Math.round(radius));
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(imageData.data);
  const data = imageData.data;

  // Compute displacement field for each pixel in the brush
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const dIdx = (py * w + px) * 4;
      const falloff = 1 - dist / r;
      let srcX = px;
      let srcY = py;
      switch (op) {
        case 'push': {
          srcX = px - direction.x * strength * falloff;
          srcY = py - direction.y * strength * falloff;
          break;
        }
        case 'pucker': {
          // Move pixels toward center
          srcX = px + (px - cx) * strength * 0.1 * falloff;
          srcY = py + (py - cy) * strength * 0.1 * falloff;
          break;
        }
        case 'bloat': {
          // Move pixels away from center
          srcX = px - (px - cx) * strength * 0.1 * falloff;
          srcY = py - (py - cy) * strength * 0.1 * falloff;
          break;
        }
        case 'twirl': {
          // Rotate pixels around center
          const angle = strength * 0.1 * falloff;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const rx = dx * cos - dy * sin;
          const ry = dx * sin + dy * cos;
          srcX = cx + rx;
          srcY = cy + ry;
          break;
        }
        case 'reconstruct': {
          // Revert to source - but source is current; skip
          continue;
        }
      }
      // Bilinear sample from src
      const sx0 = Math.floor(srcX);
      const sy0 = Math.floor(srcY);
      const fx = srcX - sx0;
      const fy = srcY - sy0;
      const sx1 = sx0 + 1;
      const sy1 = sy0 + 1;
      const getPixel = (x: number, y: number, c: number) => {
        if (x < 0) x = 0; if (x >= w) x = w - 1;
        if (y < 0) y = 0; if (y >= h) y = h - 1;
        return src[(y * w + x) * 4 + c];
      };
      for (let c = 0; c < 4; c++) {
        const v00 = getPixel(sx0, sy0, c);
        const v10 = getPixel(sx1, sy0, c);
        const v01 = getPixel(sx0, sy1, c);
        const v11 = getPixel(sx1, sy1, c);
        const v0 = v00 * (1 - fx) + v10 * fx;
        const v1 = v01 * (1 - fx) + v11 * fx;
        data[dIdx + c] = v0 * (1 - fy) + v1 * fy;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ============================================================================
// CURVES ADJUSTMENT - RGB curve editor
// points: array of {x: 0-255, y: 0-255} sorted by x
// ============================================================================

export function applyCurves(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  points: { x: number; y: number }[],
  channel: 'rgb' | 'r' | 'g' | 'b' = 'rgb',
) {
  if (points.length < 2) return;
  // Build a 256-entry LUT using linear interpolation between points
  const lut = new Uint8Array(256);
  let pIdx = 0;
  for (let i = 0; i < 256; i++) {
    while (pIdx < points.length - 1 && points[pIdx + 1].x < i) pIdx++;
    if (pIdx >= points.length - 1) {
      lut[i] = Math.max(0, Math.min(255, points[points.length - 1].y));
    } else {
      const p0 = points[pIdx];
      const p1 = points[pIdx + 1];
      if (p1.x === p0.x) {
        lut[i] = Math.max(0, Math.min(255, p1.y));
      } else {
        const t = (i - p0.x) / (p1.x - p0.x);
        lut[i] = Math.max(0, Math.min(255, p0.y + t * (p1.y - p0.y)));
      }
    }
  }
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    if (channel === 'rgb') return [lut[r], lut[g], lut[b], a];
    if (channel === 'r') return [lut[r], g, b, a];
    if (channel === 'g') return [r, lut[g], b, a];
    return [r, g, lut[b], a];
  });
}

// ============================================================================
// LEVELS ADJUSTMENT - black/white/midpoint
// ============================================================================

export function applyLevels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  black: number,    // 0-254
  white: number,    // 1-255
  gamma: number,    // 0.1-10 (1 = no change)
  channel: 'rgb' | 'r' | 'g' | 'b' = 'rgb',
) {
  const range = white - black;
  if (range <= 0) return;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i - black) / range;
    v = Math.max(0, Math.min(1, v));
    v = Math.pow(v, 1 / gamma);
    lut[i] = Math.round(v * 255);
  }
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    if (channel === 'rgb') return [lut[r], lut[g], lut[b], a];
    if (channel === 'r') return [lut[r], g, b, a];
    if (channel === 'g') return [r, lut[g], b, a];
    return [r, g, lut[b], a];
  });
}

// ============================================================================
// CHANNEL MIXER - mix R/G/B channels
// ============================================================================

export function applyChannelMixer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mixer: {
    rOut: { r: number; g: number; b: number };
    gOut: { r: number; g: number; b: number };
    bOut: { r: number; g: number; b: number };
  },
) {
  // Each output channel = mix of input channels (percentages, 0-200)
  const m = mixer;
  applyPixelTransform(ctx, w, h, (r, g, b, a) => {
    const nr = (r * m.rOut.r + g * m.rOut.g + b * m.rOut.b) / 100;
    const ng = (r * m.gOut.r + g * m.gOut.g + b * m.gOut.b) / 100;
    const nb = (r * m.bOut.r + g * m.bOut.g + b * m.bOut.b) / 100;
    return [
      Math.max(0, Math.min(255, nr)),
      Math.max(0, Math.min(255, ng)),
      Math.max(0, Math.min(255, nb)),
      a,
    ];
  });
}

// ============================================================================
// PERSPECTIVE / SKEW / DISTORT TRANSFORM
// ============================================================================

// Apply a perspective/distort transform defined by 4 corner points
// corners: { tl, tr, bl, br } - target positions for each corner
export function applyPerspectiveTransform(
  sourceCanvas: HTMLCanvasElement,
  corners: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } },
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  // Compute bounding box of the target corners
  const minX = Math.min(corners.tl.x, corners.bl.x, corners.tr.x, corners.br.x);
  const maxX = Math.max(corners.tl.x, corners.bl.x, corners.tr.x, corners.br.x);
  const minY = Math.min(corners.tl.y, corners.bl.y, corners.tr.y, corners.br.y);
  const maxY = Math.max(corners.tl.y, corners.bl.y, corners.tr.y, corners.br.y);
  const outW = Math.max(1, Math.round(maxX - minX));
  const outH = Math.max(1, Math.round(maxY - minY));
  const out = createBlankCanvas(outW, outH);
  const outCtx = out.getContext('2d')!;
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
  const src = srcCtx.getImageData(0, 0, w, h).data;

  // For each output pixel, find the source pixel via inverse bilinear interpolation
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // Normalized coordinates in output space
      const u = x / outW;
      const v = y / outH;
      // Inverse bilinear: find source (sx, sy) in [0,1]x[0,1] space
      // Use simple bilinear from corners (affine approximation)
      const top = {
        x: corners.tl.x + (corners.tr.x - corners.tl.x) * u - minX,
        y: corners.tl.y + (corners.tr.y - corners.tl.y) * u - minY,
      };
      const bot = {
        x: corners.bl.x + (corners.br.x - corners.bl.x) * u - minX,
        y: corners.bl.y + (corners.br.y - corners.bl.y) * u - minY,
      };
      // We want to find which source pixel maps to (x, y) - use forward mapping in reverse
      // Forward: out = top + (bot - top) * v_src; solve for v_src
      // For simplicity, do forward mapping: iterate source pixels and paint to dest
      void top; void bot;
    }
  }
  // Forward mapping (simpler, may have holes but works for moderate transforms)
  const out2 = createBlankCanvas(outW, outH);
  const out2Ctx = out2.getContext('2d')!;
  const outImg = out2Ctx.createImageData(outW, outH);
  const outData = outImg.data;
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const u = sx / w;
      const v = sy / h;
      const top = {
        x: corners.tl.x + (corners.tr.x - corners.tl.x) * u,
        y: corners.tl.y + (corners.tr.y - corners.tl.y) * u,
      };
      const bot = {
        x: corners.bl.x + (corners.br.x - corners.bl.x) * u,
        y: corners.bl.y + (corners.br.y - corners.bl.y) * u,
      };
      const dx = Math.round(top.x + (bot.x - top.x) * v - minX);
      const dy = Math.round(top.y + (bot.y - top.y) * v - minY);
      if (dx < 0 || dx >= outW || dy < 0 || dy >= outH) continue;
      const sIdx = (sy * w + sx) * 4;
      const dIdx = (dy * outW + dx) * 4;
      outData[dIdx] = src[sIdx];
      outData[dIdx + 1] = src[sIdx + 1];
      outData[dIdx + 2] = src[sIdx + 2];
      outData[dIdx + 3] = src[sIdx + 3];
    }
  }
  out2Ctx.putImageData(outImg, 0, 0);
  void out;
  return out2;
}

// Simple skew transform (shear)
export function applySkew(
  sourceCanvas: HTMLCanvasElement,
  skewX: number,  // -1 to 1 (ratio)
  skewY: number,  // -1 to 1
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const offsetX = Math.abs(skewX) * h;
  const offsetY = Math.abs(skewY) * w;
  const outW = Math.round(w + offsetX);
  const outH = Math.round(h + offsetY);
  const out = createBlankCanvas(outW, outH);
  const ctx = out.getContext('2d')!;
  ctx.save();
  // Translate to keep content visible
  const tx = skewX < 0 ? offsetX : 0;
  const ty = skewY < 0 ? offsetY : 0;
  ctx.transform(1, skewY, skewX, 1, tx, ty);
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
  return out;
}

// ============================================================================
// TEXT ON PATH - render text along a vector path
// ============================================================================

export function drawTextOnPath(
  ctx: CanvasRenderingContext2D,
  text: string,
  pathPoints: { x: number; y: number }[],
  fontSize: number,
  fontFamily: string,
  color: string,
) {
  if (pathPoints.length < 2) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Compute cumulative distances along path
  const distances: number[] = [0];
  for (let i = 1; i < pathPoints.length; i++) {
    const d = Math.hypot(pathPoints[i].x - pathPoints[i - 1].x, pathPoints[i].y - pathPoints[i - 1].y);
    distances.push(distances[i - 1] + d);
  }
  const totalLength = distances[distances.length - 1];

  let curDist = 0;
  for (const char of text) {
    const charWidth = ctx.measureText(char).width;
    if (curDist + charWidth / 2 > totalLength) break;
    // Find position and angle at curDist + charWidth/2
    const targetDist = curDist + charWidth / 2;
    let segIdx = 0;
    while (segIdx < distances.length - 1 && distances[segIdx + 1] < targetDist) segIdx++;
    const segStart = distances[segIdx];
    const segEnd = distances[segIdx + 1] || segStart + 1;
    const t = (targetDist - segStart) / (segEnd - segStart);
    const p0 = pathPoints[segIdx];
    const p1 = pathPoints[segIdx + 1] || p0;
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + (p1.y - p0.y) * t;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillText(char, -charWidth / 2, 0);
    ctx.restore();
    curDist += charWidth;
  }
  ctx.restore();
}

// ============================================================================
// HDR TONING / LOCAL CONTRAST ENHANCEMENT (CLAHE-lite)
// ============================================================================

export function applyHDRToning(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength: number, // 0-100
  radius: number,   // 1-20
) {
  if (strength <= 0) return;
  // Compute local mean using box blur, then enhance deviation
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const blurred = new Uint8ClampedArray(src.length);
  const r = Math.max(1, Math.round(radius));
  // Box blur
  for (let pass = 0; pass < 2; pass++) {
    const input = pass === 0 ? src : blurred;
    const tmp = new Uint8ClampedArray(input);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rs = 0, gs = 0, bs = 0, count = 0;
        for (let dx = -r; dx <= r; dx++) {
          const px = Math.max(0, Math.min(w - 1, x + dx));
          const i = (y * w + px) * 4;
          rs += input[i]; gs += input[i + 1]; bs += input[i + 2];
          count++;
        }
        const di = (y * w + x) * 4;
        tmp[di] = rs / count; tmp[di + 1] = gs / count; tmp[di + 2] = bs / count;
        tmp[di + 3] = input[di + 3];
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rs = 0, gs = 0, bs = 0, count = 0;
        for (let dy = -r; dy <= r; dy++) {
          const py = Math.max(0, Math.min(h - 1, y + dy));
          const i = (py * w + x) * 4;
          rs += tmp[i]; gs += tmp[i + 1]; bs += tmp[i + 2];
          count++;
        }
        const di = (y * w + x) * 4;
        blurred[di] = rs / count; blurred[di + 1] = gs / count; blurred[di + 2] = bs / count;
        blurred[di + 3] = tmp[di + 3];
      }
    }
  }
  // Enhance: result = blurred + amount * (src - blurred)
  const amount = strength / 50; // 0-2
  for (let i = 0; i < src.length; i += 4) {
    src[i] = Math.max(0, Math.min(255, blurred[i] + amount * (src[i] - blurred[i])));
    src[i + 1] = Math.max(0, Math.min(255, blurred[i + 1] + amount * (src[i + 1] - blurred[i + 1])));
    src[i + 2] = Math.max(0, Math.min(255, blurred[i + 2] + amount * (src[i + 2] - blurred[i + 2])));
  }
  ctx.putImageData(imageData, 0, 0);
}
