import { state } from './state.js';
import { openDB, putCourse, getCourses, delCourse } from './db.js';
import { scanDirectory, flattenFiles, fmtDuration, overallCourseProgress } from './fs.js';
import { render, updateSidebar, updateTopBar, toggleFolder, collapseAll, toggleDoneSidebar, toggleDesktopSidebar, toggleMobileSidebar, backToDashboard } from './render.js';
import { cleanupMedia, loadFile, setSaveProgress, addBookmark, renderSubtitles, toggleComplete, loadFileByPath, nextFile, prevFile } from './player.js';

/* ---------- Attach globals for inline HTML handlers ---------- */
window.pickCourseFolder = pickCourseFolder;
window.openCourse = openCourse;
window.removeCourse = removeCourse;
window.backToDashboard = backToDashboard;
window.toggleComplete = toggleComplete;
window.nextFile = nextFile;
window.prevFile = prevFile;
window.loadFileByPath = loadFileByPath;
window.toggleFolder = toggleFolder;
window.collapseAll = collapseAll;
window.toggleDoneSidebar = toggleDoneSidebar;
window.toggleDesktopSidebar = toggleDesktopSidebar;
window.toggleMobileSidebar = toggleMobileSidebar;
window.addBookmark = addBookmark;
window.exportAllProgress = exportAllProgress;
window.importAllProgress = importAllProgress;

/* ---------- Progress persistence ---------- */
async function writeProgress(course) {
  try {
    const fh = await course.handle.getFileHandle('course-progress.json', { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(course.progress, null, 2));
    await writable.close();
  } catch (e) { console.error('Failed to write progress', e); }
}
setSaveProgress(writeProgress);

window.addEventListener('lumina-toggle-done', (e) => {
  const c = state.courses.find(x => x.id === e.detail.courseId);
  if (c) writeProgress(c);
});

window.addEventListener('lumina-file-loaded', () => {
  updateSidebar(); updateTopBar(); renderSubtitles();
});

window.addEventListener('lumina-progress-updated', () => {
  updateSidebar(); updateTopBar();
});

window.addEventListener('lumina-resize', () => {
  if (state.view === 'player') { updateSidebar(); updateTopBar(); renderSubtitles(); }
});

window.addEventListener('keydown', (e) => {
  if (state.view !== 'player') return;
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); nextFile(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prevFile(); }
  else if (e.key.toLowerCase() === 'c') { toggleComplete(); }
  else if (e.key.toLowerCase() === 'b') { addBookmark(); }
});

/* ---------- Course management ---------- */
export async function pickCourseFolder() {
  if (window.__TAURI__) {
    import('./native-fs.js').then(m => m.pickTauriFolder().then(processNativeCourse).catch(e => alert(e)));
    return;
  }
  if (window.Capacitor) {
    import('./native-fs.js').then(m => m.pickCapacitorFolder().then(processNativeCourse).catch(e => alert(e)));
    return;
  }
  
  if (!window.showDirectoryPicker) {
    alert('File System Access API is not available in this browser. Please use Chrome or Edge on desktop, or use the native app wrapper.');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const course = {
      id: crypto.randomUUID(),
      name: dirHandle.name,
      handle: dirHandle,
      isNative: false,
      addedAt: Date.now(),
      lastOpened: Date.now(),
      progress: { version: 1, files: {} },
      collapsed: new Set()
    };
    await putCourse(course);
    await loadCourses();
    await openCourse(course.id);
  } catch (e) {
    if (e.name !== 'AbortError') alert('Error selecting folder: ' + e.message);
  }
}

async function processNativeCourse(nativeHandle) {
  if (!nativeHandle) return;
  const course = {
    id: crypto.randomUUID(),
    name: nativeHandle.name,
    handle: nativeHandle,
    isNative: true,
    addedAt: Date.now(),
    lastOpened: Date.now(),
    progress: { version: 1, files: {} },
    collapsed: new Set()
  };
  await putCourse(course);
  await loadCourses();
  await openCourse(course.id);
}

export async function loadCourses() {
  state.courses = await getCourses();
  for (const c of state.courses) {
    if (c.handle && c.handle.requestPermission) {
      try { await c.handle.requestPermission({ mode: 'readwrite' }); } catch(e){}
    }
    try {
      await ensureProgress(c);
      c.tree = await scanDirectory(c.handle);
      c.flatFiles = flattenFiles(c.tree);
      // Background duration pre-scan
      preloadMissingDurations(c);
    } catch (e) {
      console.warn('Preload failed for', c.name, e);
    }
  }
}

async function ensureProgress(course) {
  try {
    const fh = await course.handle.getFileHandle('course-progress.json', { create: true });
    const file = await fh.getFile();
    const text = await file.text();
    if (!text.trim()) throw new Error('empty');
    course.progress = JSON.parse(text);
  } catch (e) {
    course.progress = { version: 1, files: {} };
  }
  if (!course.collapsed) course.collapsed = new Set();
}

async function getVideoDuration(file) {
  return new Promise((resolve) => {
    const url = file.nativeUrl || URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
    
    const cleanup = () => { URL.revokeObjectURL(url); v.remove(); };
    const timeout = setTimeout(() => { cleanup(); resolve(0); }, 8000);
    
    v.onloadedmetadata = () => {
      clearTimeout(timeout);
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      cleanup();
      resolve(dur);
    };
    v.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve(0);
    };
    document.body.appendChild(v);
    v.src = url;
  });
}

async function preloadMissingDurations(course) {
  const missing = course.flatFiles.filter(f => f.type === 'video' && !course.progress.files?.[f.path]?.duration);
  if (!missing.length) return;
  let changed = false;
  for (const f of missing) {
    try {
      const file = await f.handle.getFile();
      const dur = await getVideoDuration(file);
      if (dur > 0) {
        if (!course.progress.files[f.path]) course.progress.files[f.path] = {};
        course.progress.files[f.path].duration = dur;
        changed = true;
      }
    } catch (e) { console.warn('Duration scan failed for', f.name, e); }
    await new Promise(r => setTimeout(r, 150)); // throttle
  }
  if (changed) {
    await writeProgress(course);
    if (state.view === 'dashboard') render();
    else if (state.view === 'player' && state.currentCourse?.id === course.id) {
      updateSidebar(); updateTopBar();
    }
  }
}

export async function openCourse(id, filePath = null, seekTime = 0) {
  const course = state.courses.find(c => c.id === id);
  if (!course) return;
  state.currentCourse = course;
  state.view = 'player';
  state.sidebarOpen = !state.isMobile;
  state.mobileSidebarOpen = false;

  if (course.handle.requestPermission) {
    const perm = await course.handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'denied') { alert('Permission denied. Cannot read/write course folder.'); backToDashboard(); return; }
  }

  await ensureProgress(course);
  if (!course.tree) {
    course.tree = await scanDirectory(course.handle);
    course.flatFiles = flattenFiles(course.tree);
  }
  preloadMissingDurations(course); // ensure any new files get scanned

  render();

  let target = filePath ? course.flatFiles.find(f => f.path === filePath) : null;
  if (!target) target = course.flatFiles.find(f => !course.progress?.files?.[f.path]?.completed) || course.flatFiles[0];

  if (target) {
    await loadFile(target);
    if (seekTime && target.type === 'video' && state.player) {
      const seekAndPlay = () => {
        state.player.currentTime = seekTime;
        state.player.play();
      };
      state.player.on('ready', seekAndPlay);
      if (state.player.ready) {
        seekAndPlay();
      }
    }
  }
}

export async function removeCourse(id) {
  if (!confirm('Remove this course from the dashboard? Your course files will NOT be deleted.')) return;
  await delCourse(id);
  await loadCourses();
  render();
}

/* ---------- Sync / Export / Import ---------- */
export function exportAllProgress() {
  const data = state.courses.map(c => ({
    id: c.id,
    name: c.name,
    addedAt: c.addedAt,
    progress: c.progress
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lumina-backup-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importAllProgress() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      let merged = 0;
      for (const item of imported) {
        const local = state.courses.find(c => c.id === item.id || c.name === item.name);
        if (local) {
          local.progress = item.progress || { version: 1, files: {} };
          await writeProgress(local);
          merged++;
        }
      }
      alert(`Merged progress for ${merged} course(s).`);
      await loadCourses();
      render();
    } catch (e) {
      alert('Failed to import backup: ' + e.message);
    }
  };
  input.click();
}

/* ---------- Service Worker ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('[Lumina] SW registered'))
    .catch(err => console.warn('[Lumina] SW failed', err));
}

/* ---------- Init ---------- */
(async () => {
  await loadCourses();
  render();
})();
