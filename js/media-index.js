const CACHE_DIR = '.lumina-cache';
const THUMB_DIR = 'thumbs';
const THUMB_INTERVAL = 20;
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const MAX_THUMBS = 180;
const MAX_ACTIVE_BUFFER_SECONDS = 120;

let activeIndexRun = 0;

function ensureProgress(course) {
  if (!course.progress) course.progress = { version: 1, files: {} };
  if (!course.progress.files) course.progress.files = {};
  if (!course.progress.mediaIndex) course.progress.mediaIndex = { version: 1, updatedAt: 0 };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForIdle(timeout = 1200) {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(resolve, { timeout });
    } else {
      setTimeout(resolve, 80);
    }
  });
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
  const record = course.progress?.files?.[entry.path];
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
  if (file.nativeUrl) return { url: file.nativeUrl, revoke: false };
  return { url: URL.createObjectURL(file), revoke: true };
}

export function readVideoMetadata(file) {
  return new Promise(resolve => {
    const { url, revoke } = getObjectUrl(file);
    const video = document.createElement('video');
    let done = false;

    const cleanup = (duration = 0) => {
      if (done) return;
      done = true;
      video.removeAttribute('src');
      video.load();
      video.remove();
      if (revoke) URL.revokeObjectURL(url);
      resolve(duration);
    };

    const timeout = setTimeout(() => cleanup(0), 10000);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      cleanup(duration);
    };
    video.onerror = () => {
      clearTimeout(timeout);
      cleanup(0);
    };
    video.src = url;
  });
}

export function startCourseMediaIndex(course, { onChange } = {}) {
  if (!course?.flatFiles?.length) return;
  const runId = ++activeIndexRun;

  (async () => {
    ensureProgress(course);
    let changed = false;
    const videos = course.flatFiles.filter(file => file.type === 'video');

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
      } catch (error) {
        console.warn('[Lumina] Duration indexing failed for', entry.path, error);
      }

      await sleep(250);
    }

    if (changed && onChange) await onChange(course, { changed: true, partial: false });
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
        } catch (error) {
          console.warn('[Lumina] Duration indexing failed for', entry.path, error);
        }

        await sleep(250);
      }

      if (changed && onChange) await onChange(course, { changed: true, partial: false });
    }
  })();
}

export function stopCourseMediaIndex() {
  activeIndexRun++;
}

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
  try {
    const handle = await dir.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch {
    return '';
  }
}

async function writeTextFile(dir, name, text) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBlobFile(dir, name, blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function vttTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}.000`;
}

function makeCueText(frames) {
  return `WEBVTT\n\n${frames.map(frame => (
    `${vttTime(frame.start)} --> ${vttTime(frame.end)}\n${frame.name}\n`
  )).join('\n')}`;
}

function parseThumbManifest(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.version === 1 && Array.isArray(parsed.frames) ? parsed : null;
  } catch {
    return null;
  }
}

async function cacheToObjectUrls(cacheDir, manifest) {
  const imageUrls = [];
  const frames = [];

  for (const frame of manifest.frames) {
    const handle = await cacheDir.getFileHandle(frame.name);
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    imageUrls.push(url);
    frames.push({ ...frame, url });
  }

  const vtt = `WEBVTT\n\n${frames.map(frame => (
    `${vttTime(frame.start)} --> ${vttTime(frame.end)}\n${frame.url}\n`
  )).join('\n')}`;
  const vttUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  return { vttUrl, imageUrls };
}

function captureFrame(video, canvas, quality = 0.72) {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function seekVideo(video, time) {
  return new Promise(resolve => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = time;
  });
}

async function generateThumbnails(cacheDir, entry, file, duration) {
  const key = mediaKey(entry);
  const frames = [];
  const count = Math.max(1, Math.min(MAX_THUMBS, Math.ceil(duration / THUMB_INTERVAL)));
  const { url, revoke } = getObjectUrl(file);
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('thumbnail video metadata failed'));
  });

  for (let i = 0; i < count; i++) {
    await waitForIdle();
    const start = i * THUMB_INTERVAL;
    const end = Math.min(duration, start + THUMB_INTERVAL);
    const time = Math.min(Math.max(0.1, start + 1), Math.max(0.1, duration - 0.1));
    await seekVideo(video, time);
    const blob = await captureFrame(video, canvas);
    if (!blob) continue;
    const name = `${key}-${String(i).padStart(4, '0')}.jpg`;
    await writeBlobFile(cacheDir, name, blob);
    frames.push({ start, end, name });
  }

  video.removeAttribute('src');
  video.load();
  if (revoke) URL.revokeObjectURL(url);

  const manifest = {
    version: 1,
    path: entry.path,
    key,
    generatedAt: Date.now(),
    interval: THUMB_INTERVAL,
    duration,
    size: file.size || 0,
    lastModified: file.lastModified || 0,
    frames
  };
  await writeTextFile(cacheDir, `${key}.json`, JSON.stringify(manifest, null, 2));
  await writeTextFile(cacheDir, `${key}.vtt`, makeCueText(frames));
  return manifest;
}

export async function getPreviewThumbnails(course, entry, file, duration) {
  const cacheDir = await getCacheDir(course);
  if (!cacheDir || !file || !duration) return null;

  const key = mediaKey(entry);
  const sig = videoSignature(file);
  let manifest = parseThumbManifest(await readTextFile(cacheDir, `${key}.json`));

  if (
    !manifest ||
    manifest.size !== sig.size ||
    manifest.lastModified !== sig.lastModified ||
    !manifest.frames?.length
  ) {
    manifest = await generateThumbnails(cacheDir, entry, file, duration);
  }

  if (!manifest.frames?.length) return null;
  return cacheToObjectUrls(cacheDir, manifest);
}

export function cleanupPreviewThumbnails(bundle) {
  if (!bundle) return;
  if (bundle.vttUrl) URL.revokeObjectURL(bundle.vttUrl);
  if (bundle.imageUrls) bundle.imageUrls.forEach(url => URL.revokeObjectURL(url));
}

export function warmPlaybackBuffer(player, seconds = MAX_ACTIVE_BUFFER_SECONDS) {
  const media = player?.media;
  if (!media || !Number.isFinite(player.duration) || player.duration <= 0) return;
  media.preload = 'auto';
  media.setAttribute('preload', 'auto');

  if ('fastSeek' in media) return;
  const buffered = media.buffered;
  if (!buffered?.length) return;
  const current = player.currentTime || 0;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= current && buffered.end(i) - current >= seconds) return;
  }
}

export function describeIndexProgress(course) {
  const videos = course?.flatFiles?.filter(file => file.type === 'video') || [];
  const indexed = videos.filter(file => course.progress?.files?.[file.path]?.duration).length;
  return `${indexed}/${videos.length} durations indexed`;
}
