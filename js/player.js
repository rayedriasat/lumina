import { state } from './state.js';
import { Ico } from './icons.js';
import { srtToVtt, parseVTT, fmtTime, mdToHtml, escapeHtml, flattenFiles, resolveDirHandle } from './fs.js';
import { renderPDF } from './pdf-viewer.js';
import { getPreviewThumbnails, cleanupPreviewThumbnails, warmPlaybackBuffer, attachBufferWarmer, detachBufferWarmer, buildPlyrPreviewSource } from './media-index.js';

let onSaveProgress = null;
export function setSaveProgress(fn) { onSaveProgress = fn; }

const speedOptions = Array.from({ length: 31 }, (_, i) => Math.round((0.5 + i * 0.1) * 10) / 10);

function ensureProgress(course) {
  if (!course.progress) course.progress = { version: 1, files: {} };
  if (!course.collapsed) course.collapsed = new Set();
}

function makePlayerSlidersNonFocusable(player) {
  if (!player?.elements?.container) return;
  const root = player.elements.container;
  const apply = () => {
    root.querySelectorAll('input[type="range"]').forEach(s => {
      s.setAttribute('tabindex', '-1');
      s.setAttribute('aria-hidden', 'true');
    });
  };
  apply();
  if (typeof player.once === 'function') {
    player.once('ready', apply);
  }
  // Watch for any sliders Plyr re-creates later (e.g. on quality changes).
  if (typeof MutationObserver === 'function' && !root.__luminaSliderObserver) {
    const obs = new MutationObserver(apply);
    obs.observe(root, { childList: true, subtree: true });
    root.__luminaSliderObserver = obs;
  }
}

function flushQueuedSaves() {
  if (state.notesSaveTimer) {
    clearTimeout(state.notesSaveTimer);
    state.notesSaveTimer = null;
    saveCurrentNotes();
  }
  if (state.progressSaveTimer) {
    clearTimeout(state.progressSaveTimer);
    state.progressSaveTimer = null;
    if (state.currentCourse && onSaveProgress) onSaveProgress(state.currentCourse);
  }
}

// --- Player event handlers ---
// Defined as named functions so we can attach them with player.on()
// and detach them with player.off() — and so a single seamless
// source change does not end up stacking duplicates of the same
// handler. The previous code used anonymous arrows in the non-seamless
// branch only; when loadFile() took the seamless branch (same Plyr
// instance, only `state.player.source = …`), progress, pause-save,
// ended, and destroy cleanup were never wired up. That was one of the
// sources of "playback sometimes pauses at the seeked location": the
// player was being torn down/recreated without its listeners and a
// stale state.player reference would still hold the old media.
function onPlyrTimeUpdate() {
  if (!state.player || !state.currentFile || !state.currentCourse) return;
  setPos(state.currentCourse, state.currentFile.path, state.player.currentTime, state.player.duration);
  queueProgressSave(state.currentCourse, 2000);
}
function onPlyrPause() {
  if (onSaveProgress && state.currentCourse) onSaveProgress(state.currentCourse);
}
function onPlyrEnded() {
  if (!state.currentCourse || !state.currentFile) return;
  setDone(state.currentCourse, state.currentFile.path, true);
  if (onSaveProgress) onSaveProgress(state.currentCourse);
  triggerAutoProceed(true);
}
function onPlyrDestroy() {
  if (state.saveTimer) { clearInterval(state.saveTimer); state.saveTimer = null; }
  if (state.bufferWarmDetach) { try { state.bufferWarmDetach(); } catch {} state.bufferWarmDetach = null; }
}

function ensurePlayerListeners(player) {
  if (!player || player.__luminaListeners) return;
  player.__luminaListeners = true;
  try {
    player.on('timeupdate', onPlyrTimeUpdate);
    player.on('pause', onPlyrPause);
    player.on('ended', onPlyrEnded);
    player.on('destroy', onPlyrDestroy);
  } catch {}
}

function detachPlayerListeners(player) {
  if (!player || !player.__luminaListeners) return;
  player.__luminaListeners = false;
  try {
    player.off('timeupdate', onPlyrTimeUpdate);
    player.off('pause', onPlyrPause);
    player.off('ended', onPlyrEnded);
    player.off('destroy', onPlyrDestroy);
  } catch {}
}

export function cleanupMedia() {
  flushQueuedSaves();
  if (state.resumeBanner) {
    try { dismissResumeBanner(); } catch {}
  }
  if (state.player) {
    try { detachBufferWarmer(state.player); } catch {}
    try { detachPlayerListeners(state.player); } catch {}
    try { state.player.destroy(); } catch(e){}
    state.player = null;
  }
  if (state.saveTimer) { clearInterval(state.saveTimer); state.saveTimer = null; }
  if (state.activeBlobUrl) { URL.revokeObjectURL(state.activeBlobUrl); state.activeBlobUrl = null; }
  state.activeSubUrls.forEach(u => URL.revokeObjectURL(u));
  state.activeSubUrls = [];
  cleanupPreviewThumbnails(state.activePreviewThumbs);
  state.activePreviewThumbs = null;
  state.cueData = [];
  if (state._peekCleanup) { try { state._peekCleanup(); } catch {} state._peekCleanup = null; }
  if (state.peekVideo) { state.peekVideo = null; }
  if (state.autoProceedTimer) { clearTimeout(state.autoProceedTimer); clearInterval(state.autoProceedTimer); state.autoProceedTimer = null; }
  if (state.autoProceedKeydown) { try { document.removeEventListener('keydown', state.autoProceedKeydown, true); } catch {} state.autoProceedKeydown = null; }
  if (state.thumbJob) { state.thumbJob.cancelled = true; state.thumbJob = null; }
  if (state.bufferWarmDetach) { try { state.bufferWarmDetach(); } catch {} state.bufferWarmDetach = null; }
  document.querySelectorAll('.lumina-auto-proceed,.lumina-player-feedback,.lumina-speed-feedback').forEach(el => el.remove());
  state.noteText = '';
}

export function isDone(course, path) {
  return !!course.progress?.files?.[path]?.completed;
}
export function setDone(course, path, val) {
  ensureProgress(course);
  if (!course.progress.files[path]) course.progress.files[path] = {};
  course.progress.files[path].completed = val;
  if (onSaveProgress) onSaveProgress(course);
}
export function setPos(course, path, pos, dur) {
  ensureProgress(course);
  if (!course.progress.files[path]) course.progress.files[path] = {};
  course.progress.files[path].position = pos;
  if (dur) course.progress.files[path].duration = dur;
}

function queueProgressSave(course, delay = 1200) {
  if (!course || !onSaveProgress) return;
  if (state.progressSaveTimer) clearTimeout(state.progressSaveTimer);
  state.progressSaveTimer = setTimeout(() => {
    state.progressSaveTimer = null;
    onSaveProgress(course);
  }, delay);
}
export function overallProgress(course) {
  if (!course.flatFiles || !course.flatFiles.length) return 0;
  const done = course.flatFiles.filter(f => isDone(course, f.path)).length;
  return Math.round((done / course.flatFiles.length) * 100);
}

function finishVideoSetup(entry, file, savedPos) {
  const player = state.player;
  if (!player) return;
  // Guard against a stale 'ready' / 'canplay' firing after the user
  // has already navigated to a different file.
  if (state.currentFile?.path !== entry?.path) return;
  const dur = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
  if (dur > 0) {
    ensureProgress(state.currentCourse);
    if (!state.currentCourse.progress.files[entry.path]) state.currentCourse.progress.files[entry.path] = {};
    Object.assign(state.currentCourse.progress.files[entry.path], {
      duration: dur,
      size: file.size || 0,
      lastModified: file.lastModified || 0,
      indexedAt: Date.now()
    });
  }
  if (savedPos > 0 && savedPos < (dur || Infinity)) {
    try { player.currentTime = savedPos; } catch {}
    // Show the "Resumed from MM:SS — Press Enter to start over" banner
    // only when the auto-resume actually kicked in (i.e. we are in a
    // course startup and the file had a real saved position).
    if (state.isCourseStartup) {
      showResumeBanner(savedPos, dur);
    }
  }
  // We are done with the "course startup" first-file phase; any
  // subsequent file load (sidebar, next/prev) will start from 0.
  state.isCourseStartup = false;
  try { player.play(); } catch (e) {}
  if (state.bufferWarmDetach) { try { state.bufferWarmDetach(); } catch {} }
  state.bufferWarmDetach = attachBufferWarmer(player);
  setupPreviewThumbnails(entry, file, dur);
  setupAutoProceed();
}

export async function loadFile(entry) {
  if (!entry) return;

  const isSeamlessVideo = entry.type === 'video' && state.currentFile?.type === 'video' && state.player && window.Plyr;
  const previousPath = state.currentFile?.path || null;

  if (!isSeamlessVideo) {
    cleanupMedia();
  } else {
    // Partial cleanup
    flushQueuedSaves();
    if (state.saveTimer) { clearInterval(state.saveTimer); state.saveTimer = null; }
    if (state.activeBlobUrl) { URL.revokeObjectURL(state.activeBlobUrl); state.activeBlobUrl = null; }
    state.activeSubUrls.forEach(u => URL.revokeObjectURL(u));
    state.activeSubUrls = [];
    cleanupPreviewThumbnails(state.activePreviewThumbs);
    state.activePreviewThumbs = null;
    state.cueData = [];
    if (state._peekCleanup) { try { state._peekCleanup(); } catch {} state._peekCleanup = null; }
    if (state.peekVideo) { state.peekVideo = null; }
    if (state.autoProceedTimer) { clearTimeout(state.autoProceedTimer); clearInterval(state.autoProceedTimer); state.autoProceedTimer = null; }
    if (state.thumbJob) { state.thumbJob.cancelled = true; state.thumbJob = null; }
    if (state.bufferWarmDetach) { try { state.bufferWarmDetach(); } catch {} state.bufferWarmDetach = null; }
    document.querySelectorAll('.lumina-auto-proceed').forEach(el => el.remove());
  }

  state.currentFile = entry;

  const file = await entry.handle.getFile();
  const url = file.nativeUrl || URL.createObjectURL(file);
  state.activeBlobUrl = url;

  const viewerWrap = document.getElementById('viewer-wrap');
  const notesSection = document.getElementById('notes-section');
  if (!viewerWrap) return;

  // Reset panels
  state.rightPanelOpen = false;
  renderSubtitles();

  if (entry.type === 'video') {
    const dirPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
    const baseName = entry.name.substring(0, entry.name.lastIndexOf('.'));
    const parentDir = await resolveDirHandle(state.currentCourse.handle, dirPath);
    let tracksHtml = '';
    const plyrTracks = [];
    const candidates = [`${baseName}.vtt`, `${baseName}.en.vtt`, `${baseName}.srt`, `${baseName}.en.srt`];
    state.cueData = [];
    for (const cn of candidates) {
      try {
        const sh = await parentDir.getFileHandle(cn);
        const sf = await sh.getFile();
        let txt = await sf.text();
        if (cn.endsWith('.srt')) txt = srtToVtt(txt);
        const blob = new Blob([txt], { type: 'text/vtt' });
        const u = URL.createObjectURL(blob);
        state.activeSubUrls.push(u);
        const label = cn.includes('.en.') ? 'English' : 'Subtitle';
        tracksHtml += `<track src="${u}" kind="subtitles" srclang="en" label="${label}" default>`;
        plyrTracks.push({ src: u, kind: 'subtitles', srclang: 'en', label, default: true });
        const cues = parseVTT(txt);
        if (cues.length) state.cueData = cues;
      } catch(e){}
    }

    const savedPos = state.isCourseStartup
      ? (state.currentCourse.progress?.files?.[entry.path]?.position || 0)
      : 0;
    const autoplay = true;

    if (isSeamlessVideo) {
      ensurePlayerListeners(state.player);

      state.player.source = {
        type: 'video',
        sources: [{ src: url, type: file.type || 'video/mp4' }],
        tracks: plyrTracks
      };

      // Plyr's `ready` event sometimes does not re-fire after a soft
      // source swap, which would leave the new video with no
      // duration capture, no buffer warmer, no thumbnails, and no
      // auto-proceed. Set up immediately if the new media is already
      // ready; otherwise arm a 'canplay' fallback so we never miss it.
      // The previous version of this block could call
      // `finishVideoSetup` twice — once from `canplay` and once from
      // the 2.5 s hard-cap — which in turn ran `setupPreviewThumbnails`
      // twice, causing a stale Plyr `tt` instance to take over hover
      // handling with a revoked sprite URL ("blank after a few
      // seconds" symptom). Both arms now share a single `finalize`
      // with a `finished` latch.
      const tryFinish = () => {
        const media = state.player?.media;
        if (!media) return;
        if (Number.isFinite(media.duration) && media.duration > 0 && media.readyState >= 1) {
          finishVideoSetup(entry, file, savedPos);
          return;
        }
        let finished = false;
        let hardCap = 0;
        const finalize = () => {
          if (finished) return;
          finished = true;
          try { state.player.off('canplay', onCanPlay); } catch {}
          if (hardCap) clearTimeout(hardCap);
          if (state.currentFile?.path === entry.path && state.player?.media) {
            finishVideoSetup(entry, file, savedPos);
          }
        };
        const onCanPlay = finalize;
        state.player.on('canplay', onCanPlay);
        // Hard cap: if 'canplay' never fires (rare codecs), still
        // run the setup after a short delay so the user is not
        // stuck with a player that has no listeners.
        hardCap = setTimeout(finalize, 2500);
      };
      tryFinish();

      // Start save timer again
      state.saveTimer = setInterval(() => {
        if (state.player && state.player.playing && onSaveProgress) onSaveProgress(state.currentCourse);
      }, 6000);

    } else {
      viewerWrap.innerHTML = `
        <div class="w-full flex items-center justify-center p-3 md:p-6 animate-fade-in">
          <div class="w-full max-w-[96vw] md:max-w-[88vw] aspect-video relative" style="max-height:calc(100vh - 3.5rem)">
            <video id="lumina-video" controls playsinline crossorigin="anonymous" class="w-full h-full" preload="auto" ${autoplay ? 'autoplay' : ''}>
              <source src="${url}" type="${file.type || 'video/mp4'}">
              ${tracksHtml}
            </video>
          </div>
        </div>`;

      if (window.Plyr) {
        state.player = new Plyr('#lumina-video', {
          controls: ['play-large','play','progress','current-time','mute','volume','captions','settings','pip','airplay','fullscreen'],
          tooltips: { controls: true, seek: false },
          settings: ['captions','quality','speed'],
          speed: { selected: 1, options: speedOptions },
          keyboard: { focused: true, global: true },
          previewThumbnails: { enabled: false }
        });
        makePlayerSlidersNonFocusable(state.player);
        ensurePlayerListeners(state.player);

        // Use the same `tryFinish` pattern as the seamless path: wait
        // for the media to actually be ready (readyState >= 1, valid
        // duration) before seeking. Plyr's 'ready' event fires on
        // Plyr-internal init, which can be before the <video> element
        // has metadata — setting currentTime at that point is silently
        // rejected and the video plays from 0 for a few seconds before
        // jumping, which is the "auto-resume plays from the start" bug.
        // Shared `finalize` latch avoids the canplay + 2.5s-cap double
        // call that used to spawn a duplicate Plyr `tt` instance.
        const tryFinish = () => {
          const media = state.player?.media;
          if (!media) return;
          if (Number.isFinite(media.duration) && media.duration > 0 && media.readyState >= 1) {
            finishVideoSetup(entry, file, savedPos);
            return;
          }
          let finished = false;
          let hardCap = 0;
          const finalize = () => {
            if (finished) return;
            finished = true;
            try { state.player.off('canplay', onCanPlay); } catch {}
            if (hardCap) clearTimeout(hardCap);
            if (state.currentFile?.path === entry.path && state.player?.media) {
              finishVideoSetup(entry, file, savedPos);
            }
          };
          const onCanPlay = finalize;
          state.player.on('canplay', onCanPlay);
          hardCap = setTimeout(finalize, 2500);
        };
        tryFinish();

        state.saveTimer = setInterval(() => {
          if (state.player && state.player.playing && onSaveProgress) onSaveProgress(state.currentCourse);
        }, 6000);
      }
    }

  } else if (entry.type === 'pdf') {
    renderPDF(url, viewerWrap, state);
    // PDF doesn't auto-proceed, but we show a "next" toast after a while?
    // skip for now.
  } else if (entry.type === 'html') {
    viewerWrap.innerHTML = `
      <div class="w-full animate-fade-in flex flex-col" style="min-height:calc(100vh - 3.5rem)">
        <iframe id="html-lesson" src="${url}" class="flex-1 border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-popups" style="background:#fff;min-height:calc(100vh - 3.5rem)" title="HTML Lesson"></iframe>
      </div>`;
  } else if (entry.type === 'image') {
    viewerWrap.innerHTML = `
      <div class="w-full flex items-center justify-center p-4 animate-fade-in bg-black/10" style="min-height:calc(100vh - 3.5rem)">
        <img src="${url}" class="max-w-full max-h-[calc(100vh-3.5rem)] rounded-xl shadow-2xl border border-white/5" alt="${escapeHtml(entry.name)}">
      </div>`;
  } else {
    viewerWrap.innerHTML = `<div class="flex items-center justify-center text-slate-400 p-10" style="min-height:calc(100vh - 3.5rem)">Unsupported file type: ${escapeHtml(entry.name)}</div>`;
  }

  // Render notes for every type
  renderNotesSection(entry);
  // Update UI
  window.dispatchEvent(new CustomEvent('lumina-file-loaded', {
    detail: { previousPath, path: entry.path }
  }));
}

function renderNotesSection(entry) {
  const el = document.getElementById('notes-section');
  if (!el) return;
  const saved = state.currentCourse?.progress?.files?.[entry.path]?.notes || '';
  state.noteText = saved;
  el.innerHTML = `
    <div class="glass-panel border-t border-white/10 p-4 md:p-5 animate-slide-up">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold text-slate-200 flex items-center gap-2">${Ico.note} Notes</h4>
        <span class="text-[11px] text-slate-500">Markdown supported</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <textarea id="note-input" class="w-full h-32 bg-slate-900/50 border border-white/10 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 resize-none font-mono" placeholder="Jot down key takeaways..."></textarea>
        <div id="note-preview" class="w-full h-32 overflow-auto bg-slate-900/30 border border-white/10 rounded-lg p-3 text-sm text-slate-300 prose prose-invert max-w-none"></div>
      </div>
    </div>`;
  const ta = document.getElementById('note-input');
  const preview = document.getElementById('note-preview');
  if (ta) {
    ta.value = saved;
    if (preview) preview.innerHTML = mdToHtml(saved);
    ta.addEventListener('input', (e) => {
      state.noteText = e.target.value;
      if (preview) preview.innerHTML = mdToHtml(state.noteText);
      queueNotesSave();
    });
  }
}

function queueNotesSave() {
  if (state.notesSaveTimer) clearTimeout(state.notesSaveTimer);
  state.notesSaveTimer = setTimeout(() => {
    state.notesSaveTimer = null;
    saveCurrentNotes();
  }, 500);
}

function saveCurrentNotes() {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return;
  ensureProgress(c);
  if (!c.progress.files[f.path]) c.progress.files[f.path] = {};
  c.progress.files[f.path].notes = state.noteText;
  c.progress.files[f.path].updatedAt = Date.now();
  if (onSaveProgress) onSaveProgress(c);
}

async function setupPreviewThumbnails(entry, file, duration) {
  const course = state.currentCourse;
  const path = entry?.path;
  if (!course || !entry || !state.player) return;
  if (!Number.isFinite(duration) || duration <= 0) {
    // Pull a recorded duration from the course progress if we have one.
    const recorded = course?.progress?.files?.[entry.path]?.duration;
    if (recorded) duration = recorded;
    else return;
  }
  // Already set up for this exact entry. Plyr's `setPreviewThumbnails`
  // builds a fresh `tt` instance every call, so a redundant call here
  // would tear down the live one. That stale instance keeps listening
  // for hover and tries to render with a now-revoked sprite URL, which
  // is the "blank after a few seconds" symptom.
  if (state.activePreviewThumbs?.path === path) return;

  // Mark the job so cleanupMedia() can cancel it if the user navigates away.
  const job = { cancelled: false };
  if (state.thumbJob) state.thumbJob.cancelled = true;
  state.thumbJob = job;

  try {
    const bundle = await getPreviewThumbnails(course, entry, file, duration);
    if (job.cancelled || state.currentFile?.path !== path || !state.player) {
      cleanupPreviewThumbnails(bundle);
      return;
    }
    if (!bundle) return;
    cleanupPreviewThumbnails(state.activePreviewThumbs);
    state.activePreviewThumbs = bundle;
    const src = buildPlyrPreviewSource(bundle);
    if (!src) return;
    try {
      state.player.setPreviewThumbnails({
        enabled: true,
        src
      });
    } catch (err) {
      console.warn('[Lumina] Failed to attach preview thumbnails', err);
    }
  } catch (error) {
    console.warn('[Lumina] Preview thumbnails unavailable for', path, error);
  } finally {
    if (state.thumbJob === job) state.thumbJob = null;
  }
}

/* ---------- Bookmarks ----------
 *
 * Two distinct kinds:
 *  - File-level "save" (`progress.files[path].saved`): a boolean that
 *    marks the whole file as saved. Toggled by the B key. Shown as a
 *    filled bookmark icon in the top bar and on the right panel.
 *  - Timestamp bookmark (`progress.files[path].bookmarks[]`): an
 *    array of { time, label, createdAt } entries that record a
 *    specific moment inside a video. Added with Shift+B (no prompt;
 *    a sensible default label is generated).
 */
export function isFileSaved(course, path) {
  return !!course?.progress?.files?.[path]?.saved;
}

export function toggleFileSave() {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return null;
  ensureProgress(c);
  if (!c.progress.files[f.path]) c.progress.files[f.path] = {};
  const next = !c.progress.files[f.path].saved;
  c.progress.files[f.path].saved = next;
  c.progress.files[f.path].savedAt = next ? Date.now() : null;
  if (onSaveProgress) onSaveProgress(c);
  window.dispatchEvent(new CustomEvent('lumina-file-save-toggled', { detail: { courseId: c.id, path: f.path, saved: next } }));
  showBookmarkToast(next ? 'File saved' : 'Save removed', next ? Ico.bookmarkFill : Ico.bookmark);
  refreshBookmarkUi();
  return next;
}

export function addTimestampBookmark() {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return null;
  ensureProgress(c);
  if (!c.progress.files[f.path]) c.progress.files[f.path] = {};
  if (!c.progress.files[f.path].bookmarks) c.progress.files[f.path].bookmarks = [];
  const time = (f.type === 'video' && state.player) ? state.player.currentTime : 0;
  const label = fmtTime(time);
  c.progress.files[f.path].bookmarks.push({ time, label, createdAt: Date.now() });
  c.progress.files[f.path].bookmarks.sort((a, b) => a.time - b.time);
  if (onSaveProgress) onSaveProgress(c);
  window.dispatchEvent(new CustomEvent('lumina-bookmark-added', { detail: { courseId: c.id, path: f.path, time, label } }));
  showBookmarkToast(`Bookmarked at ${fmtTime(time)}`, Ico.bookmarkFill);
  refreshBookmarkUi();
  return { time, label };
}

export function removeTimestampBookmark(idx) {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return;
  if (!c.progress.files[f.path]?.bookmarks) return;
  const list = c.progress.files[f.path].bookmarks;
  if (idx < 0 || idx >= list.length) return;
  list.splice(idx, 1);
  if (onSaveProgress) onSaveProgress(c);
  window.dispatchEvent(new CustomEvent('lumina-bookmark-removed', { detail: { courseId: c.id, path: f.path, idx } }));
  showBookmarkToast('Bookmark removed', Ico.bookmark);
  refreshBookmarkUi();
}

export function jumpToTimestamp(time) {
  const p = state.player;
  if (!p || p.destroyed) return;
  try { p.currentTime = Math.max(0, time); } catch {}
  try { p.play(); } catch {}
}

// Backward-compatible alias. Older callers invoked `addBookmark` with
// a prompt-driven label flow. We forward to the timestamp bookmark
// helper so any existing UI hook still works.
export function addBookmark() {
  return addTimestampBookmark();
}

function showBookmarkToast(message, icon) {
  const shell = getPlayerShell();
  if (!shell) return;
  const old = shell.querySelector('.lumina-bookmark-toast');
  if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'lumina-bookmark-toast';
  div.innerHTML = `<span class="lumina-bookmark-toast-icon">${icon || Ico.bookmarkFill}</span><span>${escapeHtml(message)}</span>`;
  shell.appendChild(div);
  setTimeout(() => {
    div.classList.add('lumina-bookmark-toast--hiding');
    setTimeout(() => { try { div.remove(); } catch {} }, 220);
  }, 1600);
}

// Re-render the topbar bookmark button and the right panel tabs
// when the saved state or bookmark list changes.
function refreshBookmarkUi() {
  try { window.dispatchEvent(new CustomEvent('lumina-bookmark-updated')); } catch {}
}

/* ---------- Resume banner ----------
 *
 * Shown only when a file is auto-resumed at course startup. The user
 * can press Enter (or click "Start over") to jump back to 0. The
 * banner auto-dismisses after 8 seconds of continued playback from
 * the resumed position, or immediately if the user seeks, switches
 * files, or navigates away.
 */
const RESUME_BANNER_AUTO_DISMISS_MS = 8000;

function showResumeBanner(savedPos, dur) {
  dismissResumeBanner();
  const shell = getPlayerShell();
  if (!shell) return;
  const div = document.createElement('div');
  div.className = 'lumina-resume-banner';
  div.innerHTML = `
    <div class="lumina-resume-banner-inner">
      <span class="lumina-resume-banner-icon">${Ico.clock}</span>
      <span class="lumina-resume-banner-eyebrow">Resumed <span class="lumina-resume-banner-time">${escapeHtml(fmtTime(savedPos))}</span></span>
      <button class="lumina-resume-banner-action" data-action="startover" title="Start over (Enter)">Start over</button>
      <button class="lumina-resume-banner-close" data-action="dismiss" title="Dismiss">${Ico.close}</button>
    </div>
    <div class="lumina-resume-banner-progress"><span></span></div>
  `;
  shell.appendChild(div);

  // Wire up buttons.
  div.querySelector('[data-action="startover"]').addEventListener('click', () => {
    startResumeFromBeginning();
  });
  div.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    dismissResumeBanner();
  });

  // Wall-clock auto-dismiss: 8s of real time, independent of playback
  // rate. The previous version tied the countdown to `currentTime`
  // delta via timeupdate, which meant a 2x playback rate cut the
  // visible window to ~4 wall-clock seconds and the progress bar
  // filled twice as fast — the user could not react in time.
  const shownAt = Date.now();
  const total = RESUME_BANNER_AUTO_DISMISS_MS;

  // Seek-away detection: if the user actively seeks, dismiss the
  // banner. The previous `|currentTime - savedPos| > 1.5` check used
  // raw playback-time delta, which made the banner disappear in
  // ~1.5 wall-clock seconds at 1x and ~0.4 s at 4x — long before the
  // user could react. We now compare the per-update `currentTime`
  // jump against what the elapsed wall-clock × playback rate could
  // naturally account for; anything beyond that tolerance is a real
  // user seek (Z/X, bar click, double-click, etc.) and we dismiss.
  let lastCurrentTime = savedPos;
  let lastUpdateTime = Date.now();
  const onSeekAway = () => {
    const p = state.player;
    if (!p || p.destroyed) { dismissResumeBanner(); return; }
    const cur = p.currentTime || 0;
    const now = Date.now();
    const deltaT = cur - lastCurrentTime;
    const deltaWall = (now - lastUpdateTime) / 1000;
    const rate = (p.speed && Number.isFinite(p.speed) && p.speed > 0) ? p.speed : 1;
    // 0.5 s tolerance for jitter / variable timeupdate frequency.
    if (Math.abs(deltaT) > deltaWall * rate + 0.5) {
      dismissResumeBanner();
      return;
    }
    lastCurrentTime = cur;
    lastUpdateTime = now;
  };

  // Progress bar fill: requestAnimationFrame loop driven by Date.now()
  // so the bar drains at a constant wall-clock rate regardless of
  // playback speed. Capped at 100% and stops the moment the banner
  // is dismissed.
  let rafId = 0;
  const tick = () => {
    const banner = state.resumeBanner;
    if (!banner || banner.div !== div) return;
    const elapsed = Date.now() - shownAt;
    if (elapsed >= total) { dismissResumeBanner(); return; }
    const bar = div.querySelector('.lumina-resume-banner-progress > span');
    if (bar) bar.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // Hard wall-clock timer so the banner never outlives 8s of real
  // time even if rAF is throttled (background tab, etc.).
  const autoDismissTimer = setTimeout(() => dismissResumeBanner(), total);

  state.resumeBanner = {
    div, tick, rafId, savedPos, onSeekAway, autoDismissTimer,
    keydown: onResumeBannerKeydown
  };
  try { state.player.on('timeupdate', onSeekAway); } catch {}
  document.addEventListener('keydown', onResumeBannerKeydown, true);
}

function dismissResumeBanner() {
  const banner = state.resumeBanner;
  if (!banner) return;
  state.resumeBanner = null;
  if (banner.autoDismissTimer) {
    try { clearTimeout(banner.autoDismissTimer); } catch {}
  }
  if (banner.rafId) {
    try { cancelAnimationFrame(banner.rafId); } catch {}
  }
  try { state.player?.off('timeupdate', banner.tick); } catch {}
  try { state.player?.off('timeupdate', banner.onSeekAway); } catch {}
  if (banner.keydown) {
    try { document.removeEventListener('keydown', banner.keydown, true); } catch {}
  }
  if (banner.div && banner.div.parentNode) {
    banner.div.classList.add('lumina-resume-banner--hiding');
    setTimeout(() => { try { banner.div.remove(); } catch {} }, 220);
  }
}

function startResumeFromBeginning() {
  const p = state.player;
  if (!p || p.destroyed) return;
  try { p.currentTime = 0; } catch {}
  // Persist the new position so subsequent reloads start at 0.
  const c = state.currentCourse, f = state.currentFile;
  if (c && f) {
    setPos(c, f.path, 0, p.duration);
    if (onSaveProgress) onSaveProgress(c);
  }
  dismissResumeBanner();
}

// Enter key listener for the resume banner. Registered as a
// capture-phase listener so it fires before any other keydown
// handlers; torn down when the banner is dismissed.
function onResumeBannerKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    startResumeFromBeginning();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    dismissResumeBanner();
  }
}

function getPlayerShell() {
  return document.querySelector('.plyr') || document.getElementById('viewer-wrap');
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function roundSpeed(speed) {
  return Math.round(clamp(speed, 0.5, 3.5) * 10) / 10;
}

function currentPlaybackSpeed() {
  const mediaRate = state.player?.media?.playbackRate;
  const playerRate = state.player?.speed;
  const rate = Number.isFinite(mediaRate) ? mediaRate : playerRate;
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function getPlaybackSpeedCache() {
  if (!state.playbackSpeedCache) state.playbackSpeedCache = {};
  return state.playbackSpeedCache;
}

function scheduleFeedbackRemoval(el, ms = 900) {
  setTimeout(() => {
    el.classList.add('is-hiding');
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 220);
  }, ms);
}

function showSpeedFeedback(speed) {
  const shell = getPlayerShell();
  if (!shell) return;
  shell.querySelectorAll('.lumina-speed-feedback').forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = 'lumina-speed-feedback';
  div.innerHTML = `
    <span class="lumina-speed-label">Speed</span>
    <strong>${speed.toFixed(1)}x</strong>`;
  shell.appendChild(div);
  requestAnimationFrame(() => div.classList.add('is-visible'));
  scheduleFeedbackRemoval(div, 1050);
}

function showSeekFeedback(seconds) {
  const shell = getPlayerShell();
  if (!shell) return;
  const direction = seconds >= 0 ? 'forward' : 'backward';
  shell.querySelectorAll(`.lumina-player-feedback.${direction}`).forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = `lumina-player-feedback ${direction}`;
  div.innerHTML = `
    <div class="lumina-seek-ring">
      <div class="lumina-seek-arrows">${seconds >= 0 ? '››' : '‹‹'}</div>
      <div class="lumina-seek-seconds">${Math.abs(seconds)}s</div>
    </div>`;
  shell.appendChild(div);
  requestAnimationFrame(() => div.classList.add('is-visible'));
  scheduleFeedbackRemoval(div, 720);
}

export function setPlaybackSpeed(speed, showFeedback = true) {
  if (!state.player) return;
  const next = roundSpeed(speed);
  try { state.player.speed = next; } catch(e) {}
  if (state.player.media) state.player.media.playbackRate = next;
  if (showFeedback) showSpeedFeedback(next);
}

export function adjustPlaybackSpeed(delta) {
  setPlaybackSpeed(currentPlaybackSpeed() + delta);
}

export function toggleFixedPlaybackSpeed(targetSpeed, cacheKey = null, showFeedback = true) {
  if (!state.player) return;

  const next = roundSpeed(targetSpeed);
  const key = cacheKey || `preset:${next.toFixed(1)}`;
  const cache = getPlaybackSpeedCache();
  const current = roundSpeed(currentPlaybackSpeed());
  const cached = Number.isFinite(cache[key]) ? roundSpeed(cache[key]) : null;

  if (current === next) {
    if (cached !== null && cached !== next) {
      setPlaybackSpeed(cached, showFeedback);
    } else if (showFeedback) {
      showSpeedFeedback(next);
    }
    return;
  }

  cache[key] = current;
  setPlaybackSpeed(next, showFeedback);
}

export function seekBy(seconds) {
  if (!state.player) return;
  const duration = Number.isFinite(state.player.duration) && state.player.duration > 0 ? state.player.duration : Infinity;
  const current = Number.isFinite(state.pendingSeekTarget) ? state.pendingSeekTarget : state.player.currentTime;
  state.pendingSeekTarget = clamp(current + seconds, 0, duration);
  if (state.seekRaf) cancelAnimationFrame(state.seekRaf);
  state.seekRaf = requestAnimationFrame(() => {
    const target = state.pendingSeekTarget;
    state.seekRaf = null;
    state.pendingSeekTarget = null;
    const media = state.player?.media;
    if (!media || !Number.isFinite(target)) return;
    // fastSeek seeks to the nearest keyframe — much faster than
    // currentTime for short skips like Z/X (10s).
    if (typeof media.fastSeek === 'function') {
      try { media.fastSeek(target); } catch { state.player.currentTime = target; }
    } else {
      state.player.currentTime = target;
    }
    // Top-up buffer for the new position so the next Z/X is also instant.
    setTimeout(() => { try { warmPlaybackBuffer(state.player); } catch {} }, 30);
  });
  showSeekFeedback(seconds);
}

function setupAutoProceed() {
  // placeholder: actual triggering is on video end
}

function triggerAutoProceed(fromEnd = false) {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return;
  const idx = c.flatFiles.findIndex(x => x.path === f.path);
  const next = idx >= 0 && idx < c.flatFiles.length - 1 ? c.flatFiles[idx + 1] : null;
  if (!next) return;

  const shell = getPlayerShell();
  if (!shell) return;
  // Cancel any previous auto-proceed before starting a new one. This
  // also removes its keydown listener so we never end up with multiple
  // capture-phase Enter listeners stacking across video transitions.
  if (state.autoProceedTimer) { clearInterval(state.autoProceedTimer); state.autoProceedTimer = null; }
  if (state.autoProceedKeydown) { try { document.removeEventListener('keydown', state.autoProceedKeydown, true); } catch {} state.autoProceedKeydown = null; }
  shell.querySelectorAll('.lumina-auto-proceed').forEach(el => el.remove());
  let seconds = 5;
  const totalSeconds = seconds;
  const div = document.createElement('div');
  div.className = 'lumina-auto-proceed';
  div.innerHTML = `
    <div class="lumina-next-vignette"></div>
    <div class="lumina-next-content">
      <button id="ap-now" class="lumina-next-play" style="--ap-progress:0%" title="Play next lesson">
        <span class="lumina-next-play-inner">${Ico.play}</span>
      </button>
      <div class="lumina-next-copy">
        <div class="lumina-next-eyebrow">Up next in <span id="ap-count">${seconds}</span></div>
        <h3>${escapeHtml(next.name)}</h3>
        <div class="lumina-next-actions">
          <button id="ap-cancel" class="lumina-next-secondary">Cancel</button>
          <button id="ap-now-copy" class="lumina-next-primary">Play Now</button>
        </div>
      </div>
      <div class="lumina-next-progress"><span id="ap-progress"></span></div>
    </div>`;
  shell.appendChild(div);

  function cancelProceed() {
    clearInterval(state.autoProceedTimer); state.autoProceedTimer = null;
    if (state.autoProceedKeydown) { try { document.removeEventListener('keydown', state.autoProceedKeydown, true); } catch {} state.autoProceedKeydown = null; }
    div.remove();
  }

  function proceedNow() {
    clearInterval(state.autoProceedTimer); state.autoProceedTimer = null;
    if (state.autoProceedKeydown) { try { document.removeEventListener('keydown', state.autoProceedKeydown, true); } catch {} state.autoProceedKeydown = null; }
    div.classList.add('lumina-auto-proceed--launching');
    setTimeout(() => {
      div.remove();
      loadFile(next);
    }, 380);
  }

  state.autoProceedTimer = setInterval(() => {
    seconds--;
    const num = document.getElementById('ap-count');
    if (num) num.textContent = seconds;
    const progress = ((totalSeconds - seconds) / totalSeconds) * 100;
    const bar = document.getElementById('ap-progress');
    const play = div.querySelector('.lumina-next-play');
    if (bar) bar.style.width = `${progress}%`;
    if (play) play.style.setProperty('--ap-progress', `${progress}%`);
    if (seconds <= 0) proceedNow();
  }, 1000);

  div.querySelector('#ap-cancel').onclick = cancelProceed;
  div.querySelector('#ap-now').onclick = proceedNow;
  div.querySelector('#ap-now-copy').onclick = proceedNow;

  function onEnter(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      proceedNow();
    }
  }
  state.autoProceedKeydown = onEnter;
  document.addEventListener('keydown', onEnter, true);
}

/* ---------- Right panel: Subtitles + Bookmarks tabs ----------
 *
 * The right panel hosts two tabs:
 *  - "Subtitles" — the existing captions list with search
 *  - "Bookmarks" — file save toggle + timestamp bookmarks list
 *
 * The panel is shown when the right panel is open AND at least one
 * tab has content. The tab is persisted in `state.rightPanelTab` so
 * switching files keeps the user's last choice.
 */
function getRightPanelCounts() {
  const c = state.currentCourse, f = state.currentFile;
  const subCount = (state.cueData.length > 0 && f?.type === 'video') ? state.cueData.length : 0;
  const bmCount = (c && f) ? ((c.progress?.files?.[f.path]?.bookmarks?.length) || 0) : 0;
  const saved = !!(c && f && c.progress?.files?.[f.path]?.saved);
  return { subCount, bmCount, saved, hasSubtitles: subCount > 0, hasBookmarks: saved || bmCount > 0 };
}

export function renderSubtitles() {
  renderRightPanel();
}

// `renderRightPanel` is the canonical renderer; `renderSubtitles` is
// kept as an alias so existing callers continue to work.
export function renderRightPanel() {
  const desktopEl = document.getElementById('right-panel');
  const mobileEl = document.getElementById('mobile-subtitles');
  const c = state.currentCourse, f = state.currentFile;
  const counts = getRightPanelCounts();

  // Default to bookmarks tab if the user is on a file with no
  // subtitles but does have bookmarks, and vice versa.
  if (state.rightPanelTab === 'subtitles' && !counts.hasSubtitles && counts.hasBookmarks) {
    state.rightPanelTab = 'bookmarks';
  } else if (state.rightPanelTab === 'bookmarks' && !counts.hasBookmarks && counts.hasSubtitles) {
    state.rightPanelTab = 'subtitles';
  }

  // Desktop sidebar
  if (desktopEl) {
    if (state.rightPanelOpen && (counts.hasSubtitles || counts.hasBookmarks)) {
      desktopEl.className = 'hidden md:flex w-80 shrink-0 glass border-l border-white/10 flex-col h-full overflow-hidden';
      desktopEl.innerHTML = buildRightPanelHtml({ counts, source: 'desktop' });
      wireRightPanelHandlers(desktopEl, { source: 'desktop' });
    } else {
      desktopEl.className = 'hidden';
      desktopEl.innerHTML = '';
    }
  }

  // Mobile inline block
  if (mobileEl) {
    if (state.rightPanelOpen && (counts.hasSubtitles || counts.hasBookmarks)) {
      mobileEl.className = 'md:hidden shrink-0 border-t border-white/10 bg-black/20';
      mobileEl.innerHTML = buildRightPanelHtml({ counts, source: 'mobile' });
      wireRightPanelHandlers(mobileEl, { source: 'mobile' });
    } else {
      mobileEl.className = 'hidden';
      mobileEl.innerHTML = '';
    }
  }
}

function buildRightPanelHtml({ counts, source }) {
  const tab = state.rightPanelTab;
  const titleSize = source === 'desktop' ? 'text-sm' : 'text-xs';
  const inputId = source === 'desktop' ? 'rp-search' : 'rp-search-mob';
  const listId = source === 'desktop' ? 'rp-list' : 'rp-list-mob';
  const closeTitle = tab === 'bookmarks' ? 'Hide bookmarks' : 'Hide subtitles';

  const tabsHtml = `
    <div class="flex items-center gap-1 px-2 pt-2 pb-1 shrink-0" role="tablist">
      ${counts.hasSubtitles ? `<button role="tab" data-tab="subtitles" class="rp-tab ${tab === 'subtitles' ? 'rp-tab--active' : ''}" title="Subtitles">${Ico.search} <span>Captions</span><span class="rp-tab-count">${counts.subCount}</span></button>` : ''}
      ${counts.hasBookmarks ? `<button role="tab" data-tab="bookmarks" class="rp-tab ${tab === 'bookmarks' ? 'rp-tab--active' : ''}" title="Bookmarks">${Ico.bookmark} <span>Bookmarks</span>${counts.bmCount > 0 ? `<span class="rp-tab-count">${counts.bmCount}</span>` : ''}</button>` : ''}
    </div>`;

  let bodyHtml = '';
  if (tab === 'subtitles' && counts.hasSubtitles) {
    bodyHtml = `
      <div class="p-2 shrink-0">
        <input type="text" id="${inputId}" placeholder="Search captions..." class="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 ${titleSize} text-slate-200 focus:outline-none focus:border-indigo-500/50">
      </div>
      <div class="flex-1 overflow-auto text-sm ${source === 'mobile' ? 'max-h-64' : ''}" id="${listId}">
        ${buildCuesHtml()}
      </div>`;
  } else if (tab === 'bookmarks') {
    bodyHtml = buildBookmarksTabHtml({ listId, source });
  } else {
    bodyHtml = `<div class="flex-1 flex items-center justify-center text-slate-500 text-sm p-6">Nothing to show.</div>`;
  }

  return `
    <div class="h-14 glass-strong flex items-center justify-between px-3 shrink-0">
      <span class="font-semibold text-slate-200 ${titleSize} flex items-center gap-2">${tab === 'bookmarks' ? Ico.bookmarkFill : Ico.search} ${tab === 'bookmarks' ? 'Bookmarks' : 'Subtitles'}</span>
      <button data-rp-close class="p-2 rounded-lg hover:bg-white/10 text-slate-300" title="${closeTitle}">${Ico.close}</button>
    </div>
    ${tabsHtml}
    ${bodyHtml}
  `;
}

function buildCuesHtml() {
  // Stash a lowercased copy of each cue's text on the row via a data
  // attribute so the search filter never has to read/lowercase
  // `textContent` (which forces layout) on every keystroke.
  return state.cueData.map((c, i) => `
    <div class="px-3 py-2 hover:bg-white/5 cursor-pointer text-xs text-slate-300 border-b border-white/5 transition-colors" data-cue="${escapeHtml(c.text.toLowerCase())}" onclick="window.seekToCue(${i})">
      <div class="text-indigo-400 font-mono text-[11px] mb-1">${fmtTime(c.start)} → ${fmtTime(c.end)}</div>
      <div class="line-clamp-2">${escapeHtml(c.text)}</div>
    </div>
  `).join('');
}

function buildBookmarksTabHtml({ listId }) {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) {
    return `<div class="flex-1 flex items-center justify-center text-slate-500 text-sm p-6">No file selected.</div>`;
  }
  const saved = !!c.progress?.files?.[f.path]?.saved;
  const bookmarks = c.progress?.files?.[f.path]?.bookmarks || [];
  const isVideo = f.type === 'video';
  const dur = state.player?.duration || c.progress?.files?.[f.path]?.duration || 0;

  const listHtml = bookmarks.length
    ? bookmarks.map((b, i) => `
        <div class="rp-bm-row group" data-bm="${i}">
          <div class="rp-bm-time">${escapeHtml(b.label || fmtTime(b.time))}</div>
          <div class="rp-bm-actions">
            <button data-bm-action="jump" data-bm-idx="${i}" class="rp-bm-btn rp-bm-btn--jump" title="Jump to ${fmtTime(b.time)}">${Ico.play}</button>
            <button data-bm-action="remove" data-bm-idx="${i}" class="rp-bm-btn rp-bm-btn--remove" title="Remove bookmark">${Ico.close}</button>
          </div>
        </div>
      `).join('')
    : `<div class="rp-bm-empty">No timestamp bookmarks yet.<br><span class="text-[11px] text-slate-500">Press <kbd>Shift</kbd>+<kbd>B</kbd> to add one.</span></div>`;

  return `
    <div class="p-2 shrink-0">
      <div class="rp-save-card ${saved ? 'rp-save-card--saved' : ''}">
        <div class="rp-save-text">
          <div class="rp-save-title">${saved ? 'Saved file' : 'Save this file'}</div>
          <div class="rp-save-sub">${saved ? 'Visible in your All Bookmarks list' : 'Mark this lesson as a favorite'}</div>
        </div>
        <button data-bm-action="toggle-save" class="rp-save-btn ${saved ? 'rp-save-btn--saved' : ''}" title="${saved ? 'Remove save (B)' : 'Save file (B)'}">
          ${saved ? Ico.bookmarkFill : Ico.bookmark}
        </button>
      </div>
    </div>
    <div class="rp-bm-list" id="${listId}">
      ${listHtml}
    </div>
    ${isVideo ? `
    <div class="rp-bm-foot shrink-0">
      <button data-bm-action="add" class="rp-bm-add" title="Add timestamp bookmark (Shift+B)">
        ${Ico.plus} <span>Add bookmark here</span>
      </button>
    </div>` : ''}
  `;
}

function wireRightPanelHandlers(host, { source }) {
  const inputId = source === 'desktop' ? 'rp-search' : 'rp-search-mob';
  const listId = source === 'desktop' ? 'rp-list' : 'rp-list-mob';

  // Tab switch
  host.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.rightPanelTab = btn.getAttribute('data-tab');
      renderRightPanel();
    });
  });

  // Close
  const close = host.querySelector('[data-rp-close]');
  if (close) close.addEventListener('click', () => window.toggleRightPanel());

  // Captions search — debounced, and matches against the pre-lowercased
  // `data-cue` attribute (set in buildCuesHtml) so no per-keystroke
  // layout-thrashing textContent reads. rows are cached once.
  const input = host.querySelector('#' + inputId);
  if (input) {
    let searchTimer = null;
    let rows = null;
    const runFilter = (q) => {
      if (!rows) rows = host.querySelectorAll(`#${listId} > div`);
      for (const item of rows) {
        const hay = item.dataset.cue || '';
        item.style.display = (!q || hay.includes(q)) ? '' : 'none';
      }
    };
    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runFilter(q), 120);
    });
  }

  // Bookmark actions
  host.querySelectorAll('[data-bm-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-bm-action');
      const idx = parseInt(btn.getAttribute('data-bm-idx') || '-1', 10);
      if (action === 'jump') {
        const bm = state.currentCourse?.progress?.files?.[state.currentFile?.path]?.bookmarks?.[idx];
        if (bm) jumpToTimestamp(bm.time);
      } else if (action === 'remove') {
        removeTimestampBookmark(idx);
      } else if (action === 'toggle-save') {
        toggleFileSave();
      } else if (action === 'add') {
        addTimestampBookmark();
      }
    });
  });
}

window.seekToCue = (idx) => {
  const cue = state.cueData[idx];
  if (cue && state.player) {
    state.player.currentTime = cue.start + 0.05;
    state.player.play();
  }
};
window.toggleRightPanel = () => {
  state.rightPanelOpen = !state.rightPanelOpen;
  renderSubtitles();
};

export function nextFile() {
  if (!state.currentCourse || !state.currentFile) return;
  const idx = state.currentCourse.flatFiles.findIndex(f => f.path === state.currentFile.path);
  if (idx >= 0 && idx < state.currentCourse.flatFiles.length - 1) loadFile(state.currentCourse.flatFiles[idx + 1]);
}
export function prevFile() {
  if (!state.currentCourse || !state.currentFile) return;
  const idx = state.currentCourse.flatFiles.findIndex(f => f.path === state.currentFile.path);
  if (idx > 0) loadFile(state.currentCourse.flatFiles[idx - 1]);
}

export function toggleComplete() {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return;
  setDone(c, f.path, !isDone(c, f.path));
  window.dispatchEvent(new CustomEvent('lumina-progress-updated'));
}

export function toggleCaptions() {
  const p = state.player;
  if (!p || typeof p.toggleCaptions !== 'function') return;
  try { p.toggleCaptions(); } catch {}
}

export function loadFileByPath(path) {
  if (!state.currentCourse) return;
  const f = state.currentCourse.flatFiles.find(x => x.path === path);
  if (f) loadFile(f);
}
