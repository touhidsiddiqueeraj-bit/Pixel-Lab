/**
 * file-io.ts — platform-aware image import/export.
 *
 * Why this module exists: inside the Capacitor Android WebView the app's
 * classic web save/open paths silently fail:
 *
 *   • Every "save/export" used an `<a download>` click with a data:/blob:
 *     URL. The Android WebView raises DownloadListener.onDownloadStart for
 *     those, but Capacitor registers no DownloadListener — the tap does
 *     absolutely nothing (the success toast was a lie).
 *   • `<input type="file">` relies on the WebView's file chooser, which is
 *     unreliable across OEM builds and never surfaces the permission
 *     dialogs users expect from a native app.
 *
 * On the native Android shell we therefore bypass the WebView entirely:
 *
 *   • Saving: `@capacitor/filesystem` writes the base64 payload into the
 *     PUBLIC Documents folder (`Documents/PixelLab/…`) via MediaStore on
 *     Android 10+ — no permission dialog needed on modern Android because
 *     an app may always contribute its own files there. On Android 9 and
 *     older the plugin shows the real storage permission dialog and retries
 *     the write after the user grants it (the permission strings must be
 *     declared in AndroidManifest.xml — they are).
 *   • Opening: `@capacitor/camera` with `source: Photos` launches the
 *     Android Photo Picker (PickVisualMedia) — works on every Android
 *     version, needs no permission, and cannot be blocked by the WebView.
 *
 * On the plain web (desktop browsers) everything keeps the standard
 * download/file-input behaviour.
 */

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';

/** True when running inside the Capacitor Android shell (the APK). */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Where native saves land (surfaced in success toasts). */
const NATIVE_SAVE_LOCATION = 'Documents/PixelLab';

export interface SaveResult {
  fileName: string;
  /** Human-readable destination shown in the success toast. */
  where: string;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function triggerBrowserDownload(href: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.click();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      // readAsDataURL yields "data:<mime>;base64,<payload>" — keep the payload.
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the file'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Write raw base64 into the public Documents folder (MediaStore-backed on
 * Android 10+). The Filesystem plugin triggers the storage permission dialog
 * itself on Android versions where it is actually required (9 and older) and
 * retries the write once granted — do not pre-request permissions here.
 */
async function writeToNativeDocuments(base64: string, fileName: string): Promise<SaveResult> {
  await Filesystem.writeFile({
    path: `PixelLab/${sanitizeFileName(fileName)}`,
    directory: Directory.Documents,
    data: base64,
    recursive: true,
  });
  return { fileName: sanitizeFileName(fileName), where: NATIVE_SAVE_LOCATION };
}

/** Strip characters that are illegal in Android file names. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
  return cleaned || 'untitled';
}

/** Save a canvas export as an image file (PNG/JPEG/WebP). */
export async function saveCanvasImage(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
  fileName: string,
): Promise<SaveResult> {
  if (isNativeApp()) {
    const dataUrl = canvas.toDataURL(mime, quality);
    const comma = dataUrl.indexOf(',');
    return writeToNativeDocuments(dataUrl.slice(comma + 1), fileName);
  }
  triggerBrowserDownload(canvas.toDataURL(mime, quality), fileName);
  return { fileName, where: 'Downloads' };
}

/** Save arbitrary binary data (e.g. an SVG blob) as a file. */
export async function saveBlobFile(blob: Blob, fileName: string): Promise<SaveResult> {
  if (isNativeApp()) {
    return writeToNativeDocuments(await blobToBase64(blob), fileName);
  }
  const url = URL.createObjectURL(blob);
  triggerBrowserDownload(url, fileName);
  // Defer the revoke — revoking synchronously after click() can cancel the
  // download in Firefox/older Chrome before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { fileName, where: 'Downloads' };
}

/** Save a text payload (e.g. SVG markup) as a file. */
export async function saveTextFile(text: string, fileName: string, mime: string): Promise<SaveResult> {
  return saveBlobFile(new Blob([text], { type: mime }), fileName);
}

/** Map a save/open failure to a user-facing message. */
export function describeFileError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/permission|denied|not granted/i.test(message)) {
    return 'Storage permission was denied — allow Pixel Lab access in Settings and try again';
  }
  return `Could not save: ${message || 'unknown error'}`;
}

// ---------------------------------------------------------------------------
// Opening images
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image — the file may be corrupt'));
    img.src = src;
  });
}

/**
 * Open an image from the device:
 *  • Native: Android Photo Picker (no permission, works on all versions).
 *  • Web: a transient `<input type="file">` (must be created and clicked
 *    synchronously inside the click handler so the browser keeps the
 *    user-activation gesture).
 *
 * Returns null when the user cancels. Throws on real failures.
 */
export async function pickImageFromLibrary(): Promise<{ img: HTMLImageElement; name: string } | null> {
  if (isNativeApp()) {
    let photo;
    try {
      photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The picker "cancel" is a rejection, not a failure — swallow it.
      if (/cancel/i.test(message)) return null;
      throw err;
    }
    if (!photo?.webPath) return null;
    const img = await loadImage(photo.webPath);
    // The Photo Picker hides the original filename for privacy; a neutral
    // document name is used instead (the doc name field is editable).
    return { img, name: 'Photo' };
  }

  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const picked = input.files?.[0] ?? null;
      input.value = '';
      resolve(picked);
    };
    // Modern browsers fire `cancel` when the dialog is dismissed without a
    // selection; without this the promise would dangle forever.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
  if (!file) return null;
  if (!file.type.startsWith('image/')) {
    throw new Error(`"${file.name}" is not an image file`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { img, name: file.name.replace(/\.[^/.]+$/, '') };
  } finally {
    // The image is fully decoded by now; releasing the blob URL is safe.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
