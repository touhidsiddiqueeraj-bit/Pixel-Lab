// Vector shape drawing utilities — Illustrator-style shapes

import { hexToRgb } from './image-processing';

interface ShapeStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  filled: boolean;
}

// Draw a star with N points
export function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  outerR: number, innerR: number,
  points: number,
  style: ShapeStyle,
) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  applyStyle(ctx, style);
  ctx.restore();
}

// Draw a regular polygon with N sides
export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number,
  sides: number,
  style: ShapeStyle,
) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  applyStyle(ctx, style);
  ctx.restore();
}

// Draw an arrow from (x1,y1) to (x2,y2)
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  headSize: number,
  style: ShapeStyle,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const angle = Math.atan2(dy, dx);
  const headLen = len * headSize;

  ctx.save();
  ctx.beginPath();
  // Line
  ctx.moveTo(x1, y1);
  // Stop before arrowhead
  const lineEndX = x2 - Math.cos(angle) * headLen * 0.7;
  const lineEndY = y2 - Math.sin(angle) * headLen * 0.7;
  ctx.lineTo(lineEndX, lineEndY);

  // Arrowhead
  const a1 = angle + Math.PI - 0.4;
  const a2 = angle + Math.PI + 0.4;
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(angle) * headLen + Math.cos(a1) * headLen * 0.5,
             y2 - Math.sin(angle) * headLen + Math.sin(a1) * headLen * 0.5);
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(angle) * headLen + Math.cos(a2) * headLen * 0.5,
             y2 - Math.sin(angle) * headLen + Math.sin(a2) * headLen * 0.5);

  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = style.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

// Draw a heart shape
export function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number,
  style: ShapeStyle,
) {
  ctx.save();
  ctx.beginPath();
  const s = size / 2;
  // Heart using bezier curves
  ctx.moveTo(cx, cy + s * 0.3);
  ctx.bezierCurveTo(cx, cy, cx - s, cy, cx - s, cy - s * 0.3);
  ctx.bezierCurveTo(cx - s, cy - s * 0.8, cx - s * 0.5, cy - s, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.5, cy - s, cx + s, cy - s * 0.8, cx + s, cy - s * 0.3);
  ctx.bezierCurveTo(cx + s, cy, cx, cy, cx, cy + s * 0.3);
  ctx.closePath();
  applyStyle(ctx, style);
  ctx.restore();
}

// Draw a speech bubble
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  style: ShapeStyle,
) {
  ctx.save();
  ctx.beginPath();
  const r = Math.min(w, h) * 0.15; // rounded corners
  // Rounded rectangle
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  // Tail
  const tailW = w * 0.2;
  const tailH = h * 0.25;
  const tailX = x + w * 0.3;
  ctx.lineTo(tailX + tailW, y + h);
  ctx.lineTo(tailX, y + h + tailH);
  ctx.lineTo(tailX - tailW * 0.3, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  applyStyle(ctx, style);
  ctx.restore();
}

// Draw a spiral
export function drawSpiral(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  maxRadius: number,
  turns: number,
  style: ShapeStyle,
) {
  ctx.save();
  ctx.beginPath();
  const steps = Math.max(20, turns * 40);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const r = maxRadius * t;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = style.strokeWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

// Draw a calligraphy stroke (angle-aware, flat brush)
export function drawCalligraphyStroke(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  size: number,
  angle: number,
  color: string,
  opacity: number,
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  // The brush is a flat ellipse oriented at the calligraphy angle
  // We draw filled quads between consecutive points
  const rad = (angle * Math.PI) / 180;
  const nx = Math.cos(rad + Math.PI / 2); // normal to the angle
  const ny = Math.sin(rad + Math.PI / 2);
  const halfW = size / 2;

  ctx.beginPath();
  // Start cap
  const p0 = points[0];
  ctx.moveTo(p0.x + nx * halfW, p0.y + ny * halfW);
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    ctx.lineTo(next.x + nx * halfW, next.y + ny * halfW);
  }
  // End cap and back
  const pLast = points[points.length - 1];
  ctx.lineTo(pLast.x - nx * halfW, pLast.y - ny * halfW);
  for (let i = points.length - 1; i > 0; i--) {
    const p = points[i];
    const prev = points[i - 1];
    ctx.lineTo(prev.x - nx * halfW, prev.y - ny * halfW);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draw scatter shapes along a stroke path
export function drawScatterStroke(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  count: number,
  sizeScale: number,
  color: string,
  opacity: number,
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opacity / 100;

  // Compute total path length
  let totalLen = 0;
  const segLengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segLengths.push(d);
    totalLen += d;
  }
  if (totalLen < 1) return;

  // Distribute `count` shapes along the path with random offset
  for (let i = 0; i < count; i++) {
    const dist = (i / count) * totalLen + Math.random() * (totalLen / count);
    // Find position at dist
    let accum = 0;
    let px = points[0].x, py = points[0].y;
    for (let j = 0; j < segLengths.length; j++) {
      if (accum + segLengths[j] >= dist) {
        const t = (dist - accum) / segLengths[j];
        px = points[j].x + (points[j + 1].x - points[j].x) * t;
        py = points[j].y + (points[j + 1].y - points[j].y) * t;
        break;
      }
      accum += segLengths[j];
    }
    // Random scatter offset
    const offsetX = (Math.random() - 0.5) * 30 * sizeScale;
    const offsetY = (Math.random() - 0.5) * 30 * sizeScale;
    const shapeSize = (3 + Math.random() * 8) * sizeScale;
    const rotation = Math.random() * Math.PI * 2;

    // Draw a small random shape (circle, square, or triangle)
    ctx.save();
    ctx.translate(px + offsetX, py + offsetY);
    ctx.rotate(rotation);
    ctx.fillStyle = color;
    const shapeType = Math.floor(Math.random() * 3);
    ctx.beginPath();
    if (shapeType === 0) {
      // Circle
      ctx.arc(0, 0, shapeSize, 0, Math.PI * 2);
    } else if (shapeType === 1) {
      // Square
      ctx.rect(-shapeSize, -shapeSize, shapeSize * 2, shapeSize * 2);
    } else {
      // Triangle
      ctx.moveTo(0, -shapeSize);
      ctx.lineTo(shapeSize, shapeSize);
      ctx.lineTo(-shapeSize, shapeSize);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Smooth a path using moving average
export function smoothPath(
  points: { x: number; y: number }[],
  strength: number,
): { x: number; y: number }[] {
  if (points.length < 3 || strength <= 0) return points;
  const factor = strength / 100;
  const result: { x: number; y: number }[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    // Moving average with neighbors
    const avgX = (prev.x + curr.x * 2 + next.x) / 4;
    const avgY = (prev.y + curr.y * 2 + next.y) / 4;
    result.push({
      x: curr.x + (avgX - curr.x) * factor,
      y: curr.y + (avgY - curr.y) * factor,
    });
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

// Helper to apply fill + stroke style
function applyStyle(ctx: CanvasRenderingContext2D, style: ShapeStyle) {
  if (style.filled) {
    ctx.fillStyle = style.fillColor;
    ctx.fill();
  }
  if (style.strokeWidth > 0) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// Compute star inner radius from outer radius and ratio
export function computeStarInnerR(outerR: number, ratio: number): number {
  return outerR * Math.max(0.1, Math.min(0.9, ratio));
}

// Get shape style from tool options and colors
export function makeShapeStyle(
  fillColor: string,
  strokeWidth: number,
): ShapeStyle {
  return {
    fillColor,
    strokeColor: fillColor,
    strokeWidth,
    filled: true,
  };
}
