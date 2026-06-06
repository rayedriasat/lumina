import { state, initGamification, setUsername } from './state.js';
import { openDB, putCourse, getCourses, delCourse } from './db.js';
import { scanDirectory, flattenFiles, fmtDuration, overallCourseProgress } from './fs.js';
import { render, updateSidebar, updateSidebarSelection, updateTopBar, toggleFolder, collapseAll, toggleDoneSidebar, toggleDesktopSidebar, toggleMobileSidebar, backToDashboard } from './render.js';
import { cleanupMedia, loadFile, setSaveProgress, addBookmark, renderSubtitles, toggleComplete, toggleCaptions, loadFileByPath, nextFile, prevFile, toggleFixedPlaybackSpeed, adjustPlaybackSpeed, seekBy } from './player.js';
import { startLibraryMediaIndex, stopCourseMediaIndex, describeIndexProgress, subscribeIndexingProgress } from './media-index.js';

const ENV_WARNING_DISMISS_KEY = 'lumina_env_warning_dismissed';
const indexSaveTimers = new Map();
let dashboardRenderTimers;

function detectEnvironmentWarning() {
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024);
  const hasFileSystemAccess = 'showDirectoryPicker' in window;

  if (isMobile) {
    return 'Lumina web is designed for desktop browsers. Mobile devices are not supported for the web version, and the folder picker needed by the app is not available there.';
  }

  if (!hasFileSystemAccess) {
    return 'Lumina web needs a Chromium-based desktop browser with the File System Access API. Safari, Firefox, and other nonstandard browsers are not supported for this version.';
  }

  return '';
}

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

function setUsernameSlotContent(slot, value) {
  slot.textContent = value;
  slot.title = 'Click to edit username';
  slot.classList.add('cursor-text');
  slot.onclick = () => window.editUsername();
}

window.editUsername = function() {
  const slot = document.getElementById('username-name-slot');
  if (!slot || document.getElementById('username-input')) return;

  const current = state.user?.name || 'Learner';
  const input = document.createElement('input');
  input.id = 'username-input';
  input.value = current;
  input.maxLength = 40;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Edit username');
  input.className = 'inline-flex items-center min-w-[8ch] max-w-full rounded-lg border border-indigo-400/50 bg-slate-950/70 px-2 py-0.5 leading-none outline-none focus:border-indigo-300/70 focus:ring-2 focus:ring-indigo-500/20';
  input.style.font = 'inherit';
  input.style.fontSize = 'inherit';
  input.style.fontWeight = 'inherit';
  input.style.lineHeight = 'inherit';
  input.style.letterSpacing = 'inherit';
  input.style.color = 'inherit';

  slot.textContent = '';
  slot.classList.remove('cursor-text');
  slot.removeAttribute('onclick');
  slot.removeAttribute('title');
  slot.appendChild(input);

  const restore = (value, shouldSave) => {
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
    if (shouldSave) {
      const nextName = (value || '').trim();
      if (nextName) {
        setUsername(nextName);
        setUsernameSlotContent(slot, nextName);
      } else {
        setUsernameSlotContent(slot, current);
      }
    } else {
      setUsernameSlotContent(slot, current);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      restore(input.value, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restore(current, false);
    }
  };

  const onBlur = () => {
    restore(input.value, true);
  };

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
};

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

function queueIndexedProgressSave(course) {
  if (!course) return;
  if (indexSaveTimers.has(course.id)) clearTimeout(indexSaveTimers.get(course.id));
  indexSaveTimers.set(course.id, setTimeout(async () => {
    indexSaveTimers.delete(course.id);
    await writeProgress(course);
    if (state.view === 'dashboard') render();
    else if (state.view === 'player' && state.currentCourse?.id === course.id) {
      updateSidebar();
      updateTopBar();
    }
  }, 1200));
}

function startDurationIndexing() {
  startLibraryMediaIndex(state.courses, {
    onChange(course, info) {
      if (info?.changed) {
        console.log('[Lumina]', course.name, describeIndexProgress(course).label);
        queueIndexedProgressSave(course);
      }
    }
  });
}

subscribeIndexingProgress((course, info) => {
  if (!course) return;
  state.indexingStatus[course.id] = {
    indexed: info?.indexed ?? 0,
    total: info?.total ?? 0,
    done: !!info?.done
  };
  // Avoid full re-render storms: only update when visible
  if (state.view === 'dashboard') {
    const stats = describeIndexProgress(course);
    if (stats.indexed > 0) {
      // Throttle dashboard re-renders to once per ~600ms per course.
      const key = course.id;
      if (!dashboardRenderTimers) dashboardRenderTimers = new Map();
      if (dashboardRenderTimers.has(key)) return;
      dashboardRenderTimers.set(key, setTimeout(() => {
        dashboardRenderTimers.delete(key);
        if (state.view === 'dashboard') render();
      }, 600));
    }
  } else if (state.view === 'player' && state.currentCourse?.id === course.id) {
    // In-player progress comes through onChange which writes & re-renders.
  }
});

window.addEventListener('lumina-toggle-done', (e) => {
  const c = state.courses.find(x => x.id === e.detail.courseId);
  if (c) writeProgress(c);
});

window.addEventListener('lumina-file-loaded', (e) => {
  const previousPath = e.detail?.previousPath || null;
  const currentPath = e.detail?.path || state.currentFile?.path || null;
  updateSidebarSelection(previousPath, currentPath);
  updateTopBar(); renderSubtitles();
});

window.addEventListener('lumina-progress-updated', () => {
  updateSidebar(); updateTopBar();
});

window.addEventListener('lumina-resize', () => {
  if (state.view === 'player') { updateSidebar(); updateTopBar(); renderSubtitles(); }
});

const LUMINA_SHORTCUT_KEYS = new Set(['z','x','b','c','r','g','h','y','s','d','.','arrowleft','arrowright']);

function isPlyrRangeInput(target) {
  if (!target) return false;
  if (target.tagName !== 'INPUT' || target.type !== 'range') return false;
  return !!target.closest?.('.plyr');
}

function isTextInputTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') {
    const t = (target.type || 'text').toLowerCase();
    if (t === 'range') return false;
    if (['text','search','email','url','password','number','tel','date','time','datetime-local','month','week','color','file'].includes(t)) return true;
    if (!t) return true;
  }
  if (target.isContentEditable) return true;
  return !!target.closest?.('[contenteditable=""], [contenteditable="true"]');
}

function blurActivePlyrSlider() {
  const active = document.activeElement;
  if (isPlyrRangeInput(active)) {
    try { active.blur(); } catch {}
  }
}

// Plyr sliders (range inputs) capture arrow keys natively and steal focus
// from our shortcuts. Blur the slider on pointerdown so keyboard focus
// never sits on the slider; the drag still works because Plyr handles it
// via the input's 'input' event, not via keyboard focus.
document.addEventListener('pointerdown', (e) => {
  if (isPlyrRangeInput(e.target)) {
    setTimeout(blurActivePlyrSlider, 0);
  }
}, true);

window.addEventListener('keydown', (e) => {
  if (state.view !== 'player') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toLowerCase();
  if (!LUMINA_SHORTCUT_KEYS.has(key)) return;

  // Plyr sliders are still allowed — they're the only "input" target
  // we want to override. Real text inputs keep their keys.
  if (isTextInputTarget(e.target)) return;

  let handled = true;
  if (e.key === 'ArrowRight') nextFile();
  else if (e.key === 'ArrowLeft') prevFile();
  else if (key === 'b') addBookmark();
  else if (key === '.') toggleComplete();
  else if (key === 'c') toggleCaptions();
  else if (key === 'r') toggleFixedPlaybackSpeed(1.0, 'r');
  else if (key === 'g') toggleFixedPlaybackSpeed(1.8, 'g');
  else if (key === 'h') toggleFixedPlaybackSpeed(2.5, 'h');
  else if (key === 'y') toggleFixedPlaybackSpeed(3.0, 'y');
  else if (key === 's') adjustPlaybackSpeed(-0.1);
  else if (key === 'd') adjustPlaybackSpeed(0.1);
  else if (key === 'z') seekBy(-10);
  else if (key === 'x') seekBy(10);
  else handled = false;

  if (handled) {
    e.preventDefault();
    e.stopPropagation();
    blurActivePlyrSlider();
  }
}, true);

window.dismissEnvironmentWarning = function() {
  state.environmentWarningDismissed = true;
  localStorage.setItem(ENV_WARNING_DISMISS_KEY, '1');
  render();
};

/* ---------- Course management ---------- */
export async function pickCourseFolder() {
  if (window.__TAURI__) {
    import('./native-fs.js').then(m => m.pickTauriFolder().then(processNativeCourse).catch(e => alert(e)));
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
  stopCourseMediaIndex();
  state.courses = await getCourses();
  for (const c of state.courses) {
    if (c.isNative && c.handle) {
      const m = await import('./native-fs.js');
      c.handle = await m.restoreNativeHandle(c.handle);
    } 
    
    if (c.handle && c.handle.requestPermission) {
      try { await c.handle.requestPermission({ mode: 'readwrite' }); } catch(e){}
    }
    
    try {
      if (!c.handle) throw new Error('Missing file handle');
      await ensureProgress(c);
      c.tree = await scanDirectory(c.handle);
      c.flatFiles = flattenFiles(c.tree);
    } catch (e) {
      console.warn('Preload failed for', c.name, e);
    }
  }
  startDurationIndexing();
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

export async function openCourse(id, filePath = null, seekTime = 0) {
  const course = state.courses.find(c => c.id === id);
  if (!course) return;
  state.editingUsername = false;
  state.usernameDraft = '';
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

  render();

  let target = filePath ? course.flatFiles.find(f => f.path === filePath) : null;
  if (!target) target = course.flatFiles.find(f => !course.progress?.files?.[f.path]?.completed) || course.flatFiles[0];

  if (target) {
    await loadFile(target);
    if (seekTime && target.type === 'video' && state.player) {
      const player = state.player;
      let fired = false;
      const seekAndPlay = () => {
        if (fired) return;
        fired = true;
        try { player.off('ready', seekAndPlay); } catch {}
        try { player.currentTime = seekTime; } catch {}
        try { player.play(); } catch {}
      };
      player.on('ready', seekAndPlay);
      if (player.ready) {
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
  const data = {
    user: state.user,
    courses: state.courses.map(c => ({
      id: c.id,
      name: c.name,
      addedAt: c.addedAt,
      progress: c.progress
    }))
  };
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
      const parsed = JSON.parse(text);
      const importedCourses = Array.isArray(parsed) ? parsed : (parsed.courses || []);
      
      // Import User Gamification
      if (parsed.user) {
        state.user = { ...state.user, ...parsed.user };
        localStorage.setItem('lumina_user', JSON.stringify(state.user));
      }

      let merged = 0;
      for (const item of importedCourses) {
        const local = state.courses.find(c => c.id === item.id || c.name === item.name);
        if (local) {
          local.progress = item.progress || { version: 1, files: {} };
          await writeProgress(local);
          merged++;
        }
      }
      alert(`Merged progress for ${merged} course(s). Gamification profile updated.`);
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
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('[Lumina] SW registered'))
    .catch(err => console.warn('[Lumina] SW failed', err));
}

/* ---------- Init ---------- */
(async () => {
  initGamification();
  state.environmentWarningDismissed = localStorage.getItem(ENV_WARNING_DISMISS_KEY) === '1';
  state.environmentWarning = detectEnvironmentWarning();
  await loadCourses();
  render();
})();
