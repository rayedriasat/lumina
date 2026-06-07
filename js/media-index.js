// media-index.js
// Background media indexing for Lumina:
//  - Pre-calculates video durations so total course progress is instant.
//  - Generates single-sprite seekbar preview thumbnails (memory friendly).
//  - Actively warms the HTML5 playback buffer for snappy Z/X seeking.
//
// All public functions are no-throw, return null/false on failure and
// log warnings only — the player must never crash because of an indexing
// hiccup. The whole module is designed to be safely abortable between
// courses, between videos, and on user navigation.

const CACHE_DIR = '.lumina-cache';
const THUMB_DIR = 'thumbs';

const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 135;
const THUMB_QUALITY = 0.82;
const SPRITE_COLS = 8;
const MAX_THUMBS_PER_VIDEO = 80;
const MIN_THUMBS_PER_VIDEO = 12;

const THUMB_INTERVAL_DEFAULT = 15;     // 0–10 min
const THUMB_INTERVAL_MEDIUM = 25;      // 10–30 min
const THUMB_INTERVAL_LONG = 45;         // 30 min – 1.5 h
const THUMB_INTERVAL_VERY_LONG = 90;    // > 1.5 h

const INDEX_THROTTLE_MS = 150;
const INDEX_IDLE_TIMEOUT = 1500;
const META_READ_TIMEOUT_MS = 12000;
const GENERATION_TIMEOUT_MS = 90000;

const MANIFEST_VERSION = 3;

let activeIndexRun = 0;
let activeThumbRun = 0;
const progressListeners = new Set();
const inMemoryBundles = new Map(); // path -> { vttUrl, spriteUrl, manifest }

function ensureProgress(course) {
  if (!course.progress) course.progress = { version: 1, files: {} };
  if (!course.progress.files) course.progress.files = {};
  if (!course.progress.mediaIndex) course.progress.mediaIndex = { version: 1, updatedAt: 0 };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForIdle(timeout = INDEX_IDLE_TIMEOUT) {
  return new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(resolve, { timeout });
    } else {
      setTimeout(resolve, 80);
    }
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    })
  ]);
}

function mediaKey(entry) {
  const raw = `${entry.path}:${entry.name}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function videoSignature(file) {
  return {
    size: Number.isFinite(file.size) ? file.size : 0,
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0
  };
}

function hasMatchingDuration(course, entry, file) {
  const record = course?.progress?.files?.[entry.path];
  if (!record?.duration) return false;
  const sig = videoSignature(file);
  return record.size === sig.size && record.lastModified === sig.lastModified;
}

function setDuration(course, entry, file, duration) {
  ensureProgress(course);
  if (!course.progress.files[entry.path]) course.progress.files[entry.path] = {};
  const sig = videoSignature(file);
  Object.assign(course.progress.files[entry.path], {
    duration,
    size: sig.size,
    lastModified: sig.lastModified,
    indexedAt: Date.now()
  });
  course.progress.mediaIndex.updatedAt = Date.now();
}

function getObjectUrl(file) {
  if (file?.nativeUrl) return { url: file.nativeUrl, revoke: false };
  return { url: URL.createObjectURL(file), revoke: true };
}

function emitProgress(course, info) {
  for (const listener of progressListeners) {
    try { listener(course, info); } catch (err) { console.warn('[Lumina] progress listener error', err); }
  }
}

export function subscribeIndexingProgress(listener) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

// --- File System helpers (File System Access API) ---

async function getCacheDir(course) {
  if (!course?.handle?.getDirectoryHandle) return null;
  try {
    const root = await course.handle.getDirectoryHandle(CACHE_DIR, { create: true });
    return await root.getDirectoryHandle(THUMB_DIR, { create: true });
  } catch {
    return null;
  }
}

async function readTextFile(dir, name) {
  if (!dir) return '';
  try {
    const handle = await dir.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch {
    return '';
  }
}

async function writeTextFile(dir, name, text) {
  if (!dir) return;
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBlobFile(dir, name, blob) {
  if (!dir) return;
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function removeFile(dir, name) {
  if (!dir) return;
  try { await dir.removeEntry(name); } catch {}
}

// --- VTT + sprite utilities ---

function vttTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor(Math.max(0, Math.min(0.999, seconds - Math.floor(seconds))) * 1000)
    .toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function buildSpriteVtt(spriteUrl, frames) {
  const lines = ['WEBVTT', ''];
  for (const f of frames) {
    const url = `${spriteUrl}#xywh=${f.x},${f.y},${THUMB_WIDTH},${THUMB_HEIGHT}`;
    lines.push(`${vttTime(f.start)} --> ${vttTime(f.end)}`);
    lines.push(url);
    lines.push('');
  }
  return lines.join('\n');
}

function parseThumbManifest(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.version === MANIFEST_VERSION && parsed?.sprite && Array.isArray(parsed.frames)) {
      return parsed;
    }
  } catch {}
  return null;
}

function isManifestValid(manifest, sig) {
  if (!manifest) return false;
  if (manifest.version !== MANIFEST_VERSION) return false;
  if (manifest.size !== sig.size) return false;
  if (manifest.lastModified !== sig.lastModified) return false;
  if (!Array.isArray(manifest.frames) || !manifest.frames.length) return false;
  if (!manifest.sprite?.name) return false;
  return true;
}

// --- Video metadata reading ---

export function readVideoMetadata(file) {
  return new Promise(resolve => {
    const { url, revoke } = getObjectUrl(file);
    const video = document.createElement('video');
    let done = false;

    const cleanup = (duration = 0) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      video.removeAttribute('src');
      try { video.load(); } catch {}
      video.remove();
      if (revoke) URL.revokeObjectURL(url);
      resolve(duration);
    };

    const timeout = setTimeout(() => cleanup(0), META_READ_TIMEOUT_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      cleanup(duration);
    };
    video.onerror = () => cleanup(0);
    video.src = url;
  });
}

// --- Duration indexing (background) ---

export function startCourseMediaIndex(course, { onChange } = {}) {
  if (!course?.flatFiles?.length) return;
  const runId = ++activeIndexRun;

  (async () => {
    ensureProgress(course);
    const videos = course.flatFiles.filter(file => file.type === 'video');
    let changed = false;

    emitProgress(course, { phase: 'durations', indexed: countIndexed(course), total: videos.length });

    for (const entry of videos) {
      if (runId !== activeIndexRun) return;
      await waitForIdle();

      try {
        const file = await entry.handle.getFile();
        if (hasMatchingDuration(course, entry, file)) {
          emitProgress(course, { phase: 'durations', indexed: countIndexed(course), total: videos.length });
          continue;
        }

        const duration = await readVideoMetadata(file);
        if (duration > 0) {
          setDuration(course, entry, file, duration);
          changed = true;
          if (onChange) await onChange(course, { entry, changed: true, partial: true });
        }
        emitProgress(course, { phase: 'durations', indexed: countIndexed(course), total: videos.length });
      } catch (error) {
        console.warn('[Lumina] Duration indexing failed for', entry.path, error);
      }

      await sleep(INDEX_THROTTLE_MS);
    }

    if (changed && onChange) await onChange(course, { changed: true, partial: false });
    emitProgress(course, { phase: 'durations', done: true, indexed: countIndexed(course), total: videos.length });
  })();
}

export function startLibraryMediaIndex(courses, { onChange } = {}) {
  if (!Array.isArray(courses) || !courses.length) return;
  const runId = ++activeIndexRun;

  (async () => {
    for (const course of courses) {
      if (runId !== activeIndexRun) return;
      ensureProgress(course);
      let changed = false;
      const videos = course.flatFiles?.filter(file => file.type === 'video') || [];
      emitProgress(course, { phase: 'durations', indexed: countIndexed(course), total: videos.length });

      for (const entry of videos) {
        if (runId !== activeIndexRun) return;
        await waitForIdle();

        try {
          const file = await entry.handle.getFile();
          if (hasMatchingDuration(course, entry, file)) continue;

          const duration = await readVideoMetadata(file);
          if (duration > 0) {
            setDuration(course, entry, file, duration);
            changed = true;
            if (onChange) await onChange(course, { entry, changed: true, partial: true });
          }
          emitProgress(course, { phase: 'durations', indexed: countIndexed(course), total: videos.length });
        } catch (error) {
          console.warn('[Lumina] Duration indexing failed for', entry.path, error);
        }

        await sleep(INDEX_THROTTLE_MS);
      }

      if (changed && onChange) await onChange(course, { changed: true, partial: false });
      emitProgress(course, { phase: 'durations', done: true, indexed: countIndexed(course), total: videos.length });
    }
  })();
}

export function stopCourseMediaIndex() {
  activeIndexRun++;
}

function countIndexed(course) {
  const videos = course?.flatFiles?.filter(f => f.type === 'video') || [];
  return videos.filter(f => course.progress?.files?.[f.path]?.duration).length;
}

// --- Thumbnail sprite generation ---

function pickInterval(duration) {
  if (duration > 5400) return THUMB_INTERVAL_VERY_LONG; // > 1.5 h
  if (duration > 1800) return THUMB_INTERVAL_LONG;        // > 30 min
  if (duration > 600) return THUMB_INTERVAL_MEDIUM;       // > 10 min
  return THUMB_INTERVAL_DEFAULT;
}

function seekVideo(video, time) {
  return new Promise(resolve => {
    let resolved = false;
    const onSeeked = () => {
      if (resolved) return;
      resolved = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 3000);
    video.addEventListener('seeked', () => { clearTimeout(timeout); onSeeked(); }, { once: true });
    try { video.currentTime = time; } catch { clearTimeout(timeout); resolved = true; resolve(); }
  });
}

function captureFrame(video, canvas) {
  return new Promise(resolve => {
    try {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

async function generateSpriteFrames(file, duration) {
  const interval = pickInterval(duration);
  const desired = Math.ceil(duration / interval);
  const count = Math.max(MIN_THUMBS_PER_VIDEO, Math.min(MAX_THUMBS_PER_VIDEO, desired));
  const actualInterval = duration / count;

  const { url, revoke } = getObjectUrl(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await withTimeout(new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('metadata failed'));
    }), 8000, 'sprite-meta');
  } catch {
    if (revoke) URL.revokeObjectURL(url);
    video.remove();
    return { frames: [], bitmaps: [] };
  }

  // If real duration > 0 and bigger than what the metadata reported, update.
  const realDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
  const finalCount = Math.max(MIN_THUMBS_PER_VIDEO, Math.min(MAX_THUMBS_PER_VIDEO, Math.ceil(realDuration / interval)));
  const finalInterval = realDuration / finalCount;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const bitmaps = [];
  const frames = [];

  for (let i = 0; i < finalCount; i++) {
    const start = i * finalInterval;
    const end = Math.min(realDuration, start + finalInterval);
    const time = Math.min(Math.max(0.1, start + finalInterval / 2), Math.max(0.1, realDuration - 0.1));
    await seekVideo(video, time);
    const blob = await captureFrame(video, canvas);
    if (!blob) continue;
    try {
      const bitmap = await createImageBitmap(blob);
      bitmaps.push(bitmap);
      frames.push({ start, end });
    } catch {
      // skip this frame
    }
  }

  video.removeAttribute('src');
  try { video.load(); } catch {}
  video.remove();
  if (revoke) URL.revokeObjectURL(url);

  return { frames, bitmaps, duration: realDuration };
}

function composeSprite(frames, bitmaps) {
  const count = frames.length;
  if (!count) return null;
  const cols = Math.min(SPRITE_COLS, count);
  const rows = Math.ceil(count / cols);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH * cols;
  canvas.height = THUMB_HEIGHT * rows;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    try { ctx.drawImage(bitmaps[i], col * THUMB_WIDTH, row * THUMB_HEIGHT, THUMB_WIDTH, THUMB_HEIGHT); }
    catch {}
  }

  for (const b of bitmaps) { try { b.close?.(); } catch {} }

  const positioned = frames.map((f, i) => ({
    ...f,
    x: (i % cols) * THUMB_WIDTH,
    y: Math.floor(i / cols) * THUMB_HEIGHT
  }));

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      if (!blob) { resolve(null); return; }
      resolve({ blob, frames: positioned, cols, rows });
    }, 'image/jpeg', THUMB_QUALITY);
  });
}

async function generateThumbnailSprite(cacheDir, entry, file, duration, key, runId) {
  const genPromise = (async () => {
    const { frames, bitmaps, duration: realDuration } = await generateSpriteFrames(file, duration || 0);
    if (runId !== activeThumbRun) return null;
    if (!frames.length || !bitmaps.length) return null;
    const composed = await composeSprite(frames, bitmaps);
    if (!composed) return null;
    return { ...composed, duration: realDuration };
  })();

  try {
    const result = await withTimeout(genPromise, GENERATION_TIMEOUT_MS, 'thumb-gen');
    if (!result) return null;

    const spriteName = `${key}-sprite.jpg`;
    const vttName = `${key}.vtt`;
    const jsonName = `${key}.json`;
    // Remove legacy per-frame files if upgrading from v1
    for (let i = 0; i < MAX_THUMBS_PER_VIDEO; i++) {
      await removeFile(cacheDir, `${key}-${String(i).padStart(4, '0')}.jpg`);
    }

    await writeBlobFile(cacheDir, spriteName, result.blob);
    const sig = videoSignature(file);
    const manifest = {
      version: MANIFEST_VERSION,
      path: entry.path,
      key,
      generatedAt: Date.now(),
      interval: pickInterval(result.duration),
      duration: result.duration,
      size: sig.size,
      lastModified: sig.lastModified,
      sprite: { name: spriteName, cols: result.cols, rows: result.rows, count: result.frames.length },
      frames: result.frames
    };
    await writeTextFile(cacheDir, jsonName, JSON.stringify(manifest));
    await writeTextFile(cacheDir, vttName, buildSpriteVtt('about:placeholder', result.frames));
    return manifest;
  } catch (error) {
    console.warn('[Lumina] Thumbnail generation failed for', entry.path, error);
    return null;
  }
}

async function loadSpriteBundle(cacheDir, manifest, entryPath) {
  if (!cacheDir || !manifest?.sprite) return null;
  // The previous version keyed the in-memory cache by `manifest.path`,
  // which is *undefined* (we never write that field on the manifest —
  // the real path lives on the entry, not the manifest). The lookup
  // at the call site uses `entry.path`, so the cache never hit and
  // every call leaked a fresh pair of blob URLs. Key by the entry
  // path so the second `getPreviewThumbnails` call returns the
  // already-built bundle.
  const cacheKey = entryPath || manifest.path;
  if (!cacheKey) return null;
  const inMemory = inMemoryBundles.get(cacheKey);
  if (inMemory) return inMemory;

  try {
    const handle = await cacheDir.getFileHandle(manifest.sprite.name);
    const file = await handle.getFile();
    const spriteUrl = URL.createObjectURL(file);
    const cols = manifest.sprite?.cols || SPRITE_COLS;
    const rows = manifest.sprite?.rows || 1;
    const spriteDims = await readImageDimensions(spriteUrl, THUMB_WIDTH * cols, THUMB_HEIGHT * rows);
    const vttText = buildSpriteVtt(spriteUrl, manifest.frames);
    const vttUrl = URL.createObjectURL(new Blob([vttText], { type: 'text/vtt' }));
    const bundle = { vttUrl, spriteUrl, spriteDims, manifest, path: cacheKey };
    inMemoryBundles.set(cacheKey, bundle);
    return bundle;
  } catch (error) {
    console.warn('[Lumina] Failed to load sprite bundle for', cacheKey, error);
    return null;
  }
}

function readImageDimensions(url, fallbackW, fallbackH) {
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = (w, h) => {
      if (done) return;
      done = true;
      resolve({ width: w || fallbackW, height: h || fallbackH });
    };
    img.onload = () => finish(img.naturalWidth, img.naturalHeight);
    img.onerror = () => finish(fallbackW, fallbackH);
    img.src = url;
    setTimeout(() => finish(img.naturalWidth, img.naturalHeight), 4000);
  });
}

export function cleanupPreviewThumbnails(bundle) {
  if (!bundle) return;
  if (bundle.path) inMemoryBundles.delete(bundle.path);
  if (bundle.vttUrl) { try { URL.revokeObjectURL(bundle.vttUrl); } catch {} }
  if (bundle.spriteUrl) { try { URL.revokeObjectURL(bundle.spriteUrl); } catch {} }
  if (Array.isArray(bundle.imageUrls)) bundle.imageUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
}

// Plyr's `getThumbnail` does:
//   text.startsWith("/") || text.startsWith("http://") ||
//   text.startsWith("https://") || (urlPrefix = vttDir)
// For our blob: sprite URLs, none of those prefixes match — so Plyr
// prepends the VTT blob URL's directory and produces a broken URL like
//   blob:http://host/<blob-vtt-dir>blob:http://host/<sprite-blob>
// To work around this we hand Plyr a function-form `src` that
// pre-builds the thumbnail object with urlPrefix set to ''. Plyr then
// uses each frame's `text` field verbatim as the image src.
export function buildPlyrPreviewSource(bundle) {
  if (!bundle) return null;
  const { spriteUrl, manifest, spriteDims } = bundle;
  if (!spriteUrl || !manifest?.frames?.length) return null;
  const frames = manifest.frames.map(f => ({
    startTime: f.start,
    endTime: f.end,
    text: spriteUrl,
    x: f.x,
    y: f.y,
    w: f.w || THUMB_WIDTH,
    h: f.h || THUMB_HEIGHT
  }));
  const width = spriteDims?.width || (THUMB_WIDTH * (manifest.sprite?.cols || SPRITE_COLS));
  const height = spriteDims?.height || (THUMB_HEIGHT * (manifest.sprite?.rows || 1));
  const thumbnail = {
    frames,
    height,
    width,
    urlPrefix: ''
  };
  return function source(callback) {
    try { callback([thumbnail]); } catch (err) { console.warn('[Lumina] preview src error', err); }
  };
}

// --- Public API: get preview thumbnails (lazy + cached) ---

export async function getPreviewThumbnails(course, entry, file, duration) {
  if (!course || !entry || !file) return null;

  // Return in-memory bundle if we already loaded one for this file.
  const cached = inMemoryBundles.get(entry.path);
  if (cached) return cached;

  const cacheDir = await getCacheDir(course);
  if (!cacheDir) return null;
  if (!Number.isFinite(duration) || duration <= 0) {
    // Try to read it from the saved progress.
    const recorded = course?.progress?.files?.[entry.path]?.duration;
    if (recorded) duration = recorded;
    else return null;
  }

  const key = mediaKey(entry);
  const sig = videoSignature(file);
  let manifest = parseThumbManifest(await readTextFile(cacheDir, `${key}.json`));

  if (!isManifestValid(manifest, sig)) {
    // If there's a different/older manifest, purge sprite/vtt so the next
    // attempt does not conflict.
    if (manifest?.sprite?.name) await removeFile(cacheDir, manifest.sprite.name);
    await removeFile(cacheDir, `${key}.vtt`);
    await removeFile(cacheDir, `${key}.json`);

    activeThumbRun++;
    const runId = activeThumbRun;
    manifest = await generateThumbnailSprite(cacheDir, entry, file, duration, key, runId);
  }

  if (!manifest) return null;
  const bundle = await loadSpriteBundle(cacheDir, manifest, entry.path);
  if (!bundle) return null;
  return bundle;
}

export function stopThumbnailGeneration() {
  activeThumbRun++;
}

// --- Buffer warming (active preload) ---

function getBufferedEnd(media) {
  try {
    const b = media.buffered;
    if (!b || !b.length) return 0;
    return b.end(b.length - 1);
  } catch { return 0; }
}

export function getBufferedAhead(player) {
  const media = player?.media;
  if (!media) return 0;
  const current = Number.isFinite(player.currentTime) ? player.currentTime : media.currentTime || 0;
  const end = getBufferedEnd(media);
  return Math.max(0, end - current);
}

// Hint the browser to keep media pre-loaded so the next Z/X seek lands
// on already-buffered data. We ONLY set the preload hint — we never call
// play()/pause()/currentTime ourselves. The old "play and immediately
// pause" trick caused visible jitter on a paused video and bounce-back
// after a seek, so it is gone. During natural playback the browser
// downloads chunks ahead of the playhead on its own.
export function warmPlaybackBuffer(player) {
  const media = player?.media;
  if (!media) return;
  try {
    media.preload = 'auto';
    media.setAttribute('preload', 'auto');
  } catch {}
}

// Attach the preload hint for the active media. Returns a detach
// function for API symmetry; there are no timers or listeners to tear
// down (an earlier version ran a per-4s interval + 'progress' listener
// that did no work — pure overhead on every playing video).
export function attachBufferWarmer(player) {
  warmPlaybackBuffer(player);
  return () => {};
}

export function detachBufferWarmer() {}

// --- Misc ---

export function describeIndexProgress(course) {
  const videos = course?.flatFiles?.filter(file => file.type === 'video') || [];
  const indexed = videos.filter(file => course.progress?.files?.[file.path]?.duration).length;
  return { indexed, total: videos.length, label: `${indexed}/${videos.length} durations indexed` };
}
