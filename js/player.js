import { state } from './state.js';
import { Ico } from './icons.js';
import { srtToVtt, parseVTT, fmtTime, mdToHtml, escapeHtml, flattenFiles, resolveDirHandle } from './fs.js';
import { renderPDF } from './pdf-viewer.js';

let onSaveProgress = null;
export function setSaveProgress(fn) { onSaveProgress = fn; }

const speedOptions = Array.from({ length: 31 }, (_, i) => Math.round((0.5 + i * 0.1) * 10) / 10);

function ensureProgress(course) {
  if (!course.progress) course.progress = { version: 1, files: {} };
  if (!course.collapsed) course.collapsed = new Set();
}

export function cleanupMedia() {
  if (state.player) { try { state.player.destroy(); } catch(e){} state.player = null; }
  if (state.saveTimer) { clearInterval(state.saveTimer); state.saveTimer = null; }
  if (state.activeBlobUrl) { URL.revokeObjectURL(state.activeBlobUrl); state.activeBlobUrl = null; }
  state.activeSubUrls.forEach(u => URL.revokeObjectURL(u));
  state.activeSubUrls = [];
  state.cueData = [];
  if (state._peekCleanup) { state._peekCleanup(); state._peekCleanup = null; }
  if (state.peekVideo) { state.peekVideo = null; }
  if (state.autoProceedTimer) { clearInterval(state.autoProceedTimer); state.autoProceedTimer = null; }
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
export function overallProgress(course) {
  if (!course.flatFiles || !course.flatFiles.length) return 0;
  const done = course.flatFiles.filter(f => isDone(course, f.path)).length;
  return Math.round((done / course.flatFiles.length) * 100);
}

export async function loadFile(entry) {
  if (!entry) return;

  const isSeamlessVideo = entry.type === 'video' && state.currentFile?.type === 'video' && state.player && window.Plyr;
  const previousPath = state.currentFile?.path || null;

  if (!isSeamlessVideo) {
    cleanupMedia();
  } else {
    // Partial cleanup
    if (state.saveTimer) { clearInterval(state.saveTimer); state.saveTimer = null; }
    if (state.activeBlobUrl) { URL.revokeObjectURL(state.activeBlobUrl); state.activeBlobUrl = null; }
    state.activeSubUrls.forEach(u => URL.revokeObjectURL(u));
    state.activeSubUrls = [];
    state.cueData = [];
    if (state._peekCleanup) { state._peekCleanup(); state._peekCleanup = null; }
    if (state.peekVideo) { state.peekVideo = null; }
    if (state.autoProceedTimer) { clearTimeout(state.autoProceedTimer); state.autoProceedTimer = null; }
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
  state.rightPanelOpen = true;
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

    const savedPos = state.currentCourse.progress?.files?.[entry.path]?.position || 0;
    const autoplay = true;

    if (isSeamlessVideo) {
      state.player.source = {
        type: 'video',
        sources: [{ src: url, type: file.type || 'video/mp4' }],
        tracks: plyrTracks
      };
      
      const onReady = () => {
        state.player.off('ready', onReady);
        const dur = state.player.duration;
        if (dur && dur > 0) {
          ensureProgress(state.currentCourse);
          if (!state.currentCourse.progress.files[entry.path]) state.currentCourse.progress.files[entry.path] = {};
          state.currentCourse.progress.files[entry.path].duration = dur;
        }
        if (savedPos > 0 && savedPos < (dur || Infinity)) {
          state.player.currentTime = savedPos;
        }
        try { state.player.play(); } catch(e){}
        setupPeek(url);
        setupAutoProceed();
      };
      state.player.on('ready', onReady);
      
      // Start save timer again
      state.saveTimer = setInterval(() => {
        if (state.player && state.player.playing && onSaveProgress) onSaveProgress(state.currentCourse);
      }, 6000);

    } else {
      viewerWrap.innerHTML = `
        <div class="w-full flex items-center justify-center p-3 md:p-6 animate-fade-in">
          <div class="w-full max-w-[96vw] md:max-w-[88vw] aspect-video relative" style="max-height:calc(100vh - 3.5rem)">
            <video id="lumina-video" controls crossorigin playsinline class="w-full h-full" preload="metadata" ${autoplay ? 'autoplay' : ''}>
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
          keyboard: { focused: true, global: true }
        });
        state.player.on('ready', () => {
          const dur = state.player.duration;
          if (dur && dur > 0) {
            ensureProgress(state.currentCourse);
            const path = state.currentFile.path;
            if (!state.currentCourse.progress.files[path]) state.currentCourse.progress.files[path] = {};
            state.currentCourse.progress.files[path].duration = dur;
          }
          const savedPos = state.currentCourse.progress?.files?.[state.currentFile.path]?.position || 0;
          if (savedPos > 0 && savedPos < (dur || Infinity)) {
            state.player.currentTime = savedPos;
          }
          try { state.player.play(); } catch(e){}
          if (state._peekCleanup) { state._peekCleanup(); state._peekCleanup = null; }
          setupPeek(state.activeBlobUrl);
          setupAutoProceed();
        });
        state.player.on('timeupdate', () => {
          setPos(state.currentCourse, state.currentFile.path, state.player.currentTime, state.player.duration);
        });
        state.player.on('pause', () => {
          if (onSaveProgress) onSaveProgress(state.currentCourse);
        });
        state.player.on('ended', () => {
          setDone(state.currentCourse, state.currentFile.path, true);
          if (onSaveProgress) onSaveProgress(state.currentCourse);
          triggerAutoProceed(true);
        });
        state.saveTimer = setInterval(() => {
          if (state.player && state.player.playing && onSaveProgress) onSaveProgress(state.currentCourse);
        }, 6000);
        state.player.on('destroy', () => { if (state.saveTimer) clearInterval(state.saveTimer); state.saveTimer = null; });
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
      saveCurrentNotes();
    });
  }
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

export function addBookmark() {
  const c = state.currentCourse, f = state.currentFile;
  if (!c || !f) return;
  ensureProgress(c);
  if (!c.progress.files[f.path]) c.progress.files[f.path] = {};
  if (!c.progress.files[f.path].bookmarks) c.progress.files[f.path].bookmarks = [];
  const time = (f.type === 'video' && state.player) ? state.player.currentTime : 0;
  const label = prompt('Bookmark label:', f.type === 'video' ? fmtTime(time) + ' — ' + f.name : f.name);
  if (label === null) return;
  c.progress.files[f.path].bookmarks.push({ time, label, createdAt: Date.now() });
  if (onSaveProgress) onSaveProgress(c);
  window.dispatchEvent(new CustomEvent('lumina-bookmark-added'));
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
  const current = Number.isFinite(state.player.currentTime) ? state.player.currentTime : 0;
  state.player.currentTime = clamp(current + seconds, 0, duration);
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
  if (state.autoProceedTimer) { clearInterval(state.autoProceedTimer); state.autoProceedTimer = null; }
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
    div.remove();
    document.removeEventListener('keydown', onEnter, true);
  }

  function proceedNow() {
    clearInterval(state.autoProceedTimer); state.autoProceedTimer = null;
    document.removeEventListener('keydown', onEnter, true);
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
  document.addEventListener('keydown', onEnter, true);
}

function setupPeek(url) {
  const progressEl = document.querySelector('.plyr__progress');
  if (!progressEl) return;

  const peekVideo = document.createElement('video');
  peekVideo.src = url; peekVideo.muted = true; peekVideo.preload = 'auto';
  peekVideo.crossOrigin = 'anonymous';
  peekVideo.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(peekVideo);
  state.peekVideo = peekVideo;

  const tooltip = document.createElement('div');
  tooltip.className = 'seek-peek-tooltip';
  tooltip.style.display = 'none';
  tooltip.innerHTML = `<canvas id="peek-canvas" width="160" height="90"></canvas><div class="peek-time">00:00</div>`;
  progressEl.appendChild(tooltip);

  const canvas = tooltip.querySelector('#peek-canvas');
  const ctx = canvas.getContext('2d');
  let seekTimeout = null;
  let pendingTime = 0;

  const onSeeked = () => {
    if (tooltip.style.display === 'none') return;
    ctx.drawImage(peekVideo, 0, 0, 160, 90);
    tooltip.querySelector('.peek-time').textContent = fmtTime(peekVideo.currentTime);
  };
  peekVideo.addEventListener('seeked', onSeeked);

  const onMove = (e) => {
    if (!state.player || !state.player.duration) return;
    const rect = progressEl.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const time = pct * state.player.duration;
    pendingTime = time;

    tooltip.style.display = 'block';
    
    // Bounds check to ensure tooltip stays inside the progress bar width bounds
    const tx = Math.max(80, Math.min(rect.width - 80, x));
    
    tooltip.style.left = tx + 'px';
    tooltip.style.top = '0px';
    tooltip.querySelector('.peek-time').textContent = fmtTime(time);

    clearTimeout(seekTimeout);
    seekTimeout = setTimeout(() => {
      if (peekVideo.readyState >= 1) peekVideo.currentTime = pendingTime;
    }, 50);
  };

  const onLeave = () => { tooltip.style.display = 'none'; };

  progressEl.addEventListener('mousemove', onMove);
  progressEl.addEventListener('mouseleave', onLeave);
  progressEl.addEventListener('touchmove', onMove, { passive: true });
  progressEl.addEventListener('touchend', onLeave);

  state._peekCleanup = () => {
    progressEl.removeEventListener('mousemove', onMove);
    progressEl.removeEventListener('mouseleave', onLeave);
    progressEl.removeEventListener('touchmove', onMove);
    progressEl.removeEventListener('touchend', onLeave);
    peekVideo.removeEventListener('seeked', onSeeked);
    tooltip.remove(); peekVideo.remove();
  };
}

export function renderSubtitles() {
  const desktopEl = document.getElementById('right-panel');
  const mobileEl = document.getElementById('mobile-subtitles');
  const hasSubs = state.cueData.length > 0 && state.currentFile?.type === 'video';

  const cuesHtml = state.cueData.map((c, i) => `
    <div class="px-3 py-2 hover:bg-white/5 cursor-pointer text-xs text-slate-300 border-b border-white/5 transition-colors" onclick="window.seekToCue(${i})">
      <div class="text-indigo-400 font-mono text-[11px] mb-1">${fmtTime(c.start)} → ${fmtTime(c.end)}</div>
      <div class="line-clamp-2">${escapeHtml(c.text)}</div>
    </div>
  `).join('');

  // Desktop sidebar
  if (desktopEl) {
    if (state.rightPanelOpen && hasSubs) {
      desktopEl.className = 'hidden md:flex w-80 shrink-0 glass border-l border-white/10 flex-col h-full overflow-hidden';
      desktopEl.innerHTML = `
        <div class="h-14 glass-strong flex items-center justify-between px-3 shrink-0">
          <span class="font-semibold text-slate-200 text-sm flex items-center gap-2">${Ico.search} Subtitles</span>
          <button onclick="window.toggleRightPanel()" class="p-2 rounded-lg hover:bg-white/10 text-slate-300" title="Hide subtitles">${Ico.close}</button>
        </div>
        <div class="p-2 shrink-0">
          <input type="text" id="sub-search" placeholder="Search captions..." class="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50">
        </div>
        <div class="flex-1 overflow-auto text-sm" id="sub-list">
          ${cuesHtml}
        </div>
      `;
    } else {
      desktopEl.className = 'hidden';
      desktopEl.innerHTML = '';
    }
  }

  // Mobile inline block
  if (mobileEl) {
    if (state.rightPanelOpen && hasSubs) {
      mobileEl.className = 'md:hidden shrink-0 border-t border-white/10 bg-black/20';
      mobileEl.innerHTML = `
        <div class="flex items-center justify-between px-3 py-2 bg-slate-900/50 border-b border-white/10">
          <span class="text-xs font-semibold text-slate-200 flex items-center gap-2">${Ico.search} Subtitles</span>
          <button onclick="window.toggleRightPanel()" class="p-1.5 rounded hover:bg-white/10 text-slate-400" title="Hide subtitles">${Ico.close}</button>
        </div>
        <div class="p-2">
          <input type="text" id="sub-search-mob" placeholder="Search captions..." class="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50">
        </div>
        <div class="max-h-64 overflow-auto text-sm" id="sub-list-mob">
          ${cuesHtml}
        </div>
      `;
    } else {
      mobileEl.className = 'hidden';
      mobileEl.innerHTML = '';
    }
  }

  // Search listeners
  const attachSearch = (inputId, listId) => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const items = document.querySelectorAll(`#${listId} > div`);
        items.forEach(item => {
          item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  };
  attachSearch('sub-search', 'sub-list');
  attachSearch('sub-search-mob', 'sub-list-mob');
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

export function loadFileByPath(path) {
  if (!state.currentCourse) return;
  const f = state.currentCourse.flatFiles.find(x => x.path === path);
  if (f) loadFile(f);
}
