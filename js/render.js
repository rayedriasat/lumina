import { state } from './state.js';
import { Ico } from './icons.js';
import { escapeHtml, fmtTime, fmtDuration, overallCourseProgress, folderProgress, isFolderDone, getDescendantFiles, flattenAll, circularProgressSVG } from './fs.js';
import { overallProgress, isDone, isFileSaved, cleanupMedia, loadFile, renderSubtitles, renderRightPanel, toggleComplete, loadFileByPath, nextFile, prevFile, setDone, toggleFileSave, addTimestampBookmark, removeTimestampBookmark, jumpToTimestamp } from './player.js';

export function render() {
  const app = document.getElementById('app');
  if (!app) return;
  if (state.view !== state.lastRenderView || state.subView !== state.lastRenderSubView || state.view === 'dashboard') {
    const dashboardScrollTop = state.view === 'dashboard' ? (app.firstElementChild?.scrollTop || 0) : 0;
    const dashboardScrollLeft = state.view === 'dashboard' ? (app.firstElementChild?.scrollLeft || 0) : 0;
    const animate = state.view !== state.lastRenderView || state.subView !== state.lastRenderSubView;
    state.lastRenderView = state.view;
    state.lastRenderSubView = state.subView;
    if (state.view === 'dashboard') {
      if (state.subView === 'all-bookmarks') renderAllBookmarks(app, { animate });
      else if (state.subView === 'all-notes') renderAllNotes(app, { animate });
      else renderDashboard(app, { animate });
    } else if (state.view === 'player') renderPlayer(app);
    if (state.view === 'dashboard') {
      const scrollHost = app.firstElementChild;
      if (scrollHost) {
        scrollHost.scrollTop = dashboardScrollTop;
        scrollHost.scrollLeft = dashboardScrollLeft;
      }
    }
  } else if (state.view === 'player') {
    updateSidebar(); updateTopBar(); renderSubtitles();
  }
}

// Coalesce rapid render() calls into a single rAF-tick DOM update.
// Background data updates (indexing progress, debounced saves, etc.) can
// fire several render() calls within a few ms; without coalescing each
// one replaces #app.innerHTML and replays the fade-in animation, which
// produces the visible "jitter" on first load and during heavy work.
// User-initiated renders should call render() directly so the UI updates
// on the same click that triggered it.
let renderRaf = null;
export function scheduleRender() {
  if (renderRaf != null) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = null;
    render();
  });
}

function computeDashboardStats() {
  let courses = state.courses.length;
  let completed = 0, notes = 0, bookmarks = 0;
  for (const c of state.courses) {
    if (c.flatFiles) completed += c.flatFiles.filter(f => isDone(c, f.path)).length;
    if (c.progress?.files) {
      for (const key in c.progress.files) {
        const p = c.progress.files[key];
        if (p.notes) notes++;
        if (p.bookmarks?.length) bookmarks += p.bookmarks.length;
      }
    }
  }
  return { courses, completed, notes, bookmarks };
}

function getAllBookmarks(limit = 20) {
  const list = [];
  for (const c of state.courses) {
    if (!c.progress?.files) continue;
    for (const key in c.progress.files) {
      const p = c.progress.files[key];
      if (p.bookmarks) {
        for (const b of p.bookmarks) {
          list.push({ ...b, courseId: c.id, courseName: c.name, path: key });
        }
      }
    }
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list.slice(0, limit);
}

function getAllNotes(limit = 20) {
  const list = [];
  for (const c of state.courses) {
    if (!c.progress?.files) continue;
    for (const key in c.progress.files) {
      const p = c.progress.files[key];
      if (p.notes && p.notes.trim()) {
        list.push({ text: p.notes, courseId: c.id, courseName: c.name, path: key, title: key.split('/').pop() });
      }
    }
  }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list.slice(0, limit);
}

// --- Gamified Dashboard Map ---
function renderCourseMap(course, { animate = true } = {}) {
  const mapAnimClass = animate ? 'animate-fade-in' : '';
  const stats = overallCourseProgress(course);
  const durDone = fmtDuration(stats.durationDone);
  const durTotal = fmtDuration(stats.durationTotal);
  const durStr = durTotal ? `${durDone} / ${durTotal}` : '';
  const wPct = stats.weightedPct;

  function buildMap(nodes, depth = 0) {
    if (!nodes || !nodes.length) return '';
    return `<div class="flex flex-col gap-0.5 ${depth > 0 ? 'ml-3 border-l border-white/5 pl-2 mt-1' : ''}">
      ${nodes.map(n => {
        if (n.kind === 'directory') {
          const fp = folderProgress(n, course);
          const isClosed = course.collapsed.has(n.path);
          return `
            <div class="group cursor-pointer select-none" data-map-course="${escapeHtml(course.id)}" data-map-path="${escapeHtml(n.path)}">
              <div onclick="window.toggleFolderMap('${course.id}','${n.path.replace(/'/g,"\\'")}')" class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors">
                <span class="folder-caret ${isClosed?'closed':'open'} text-slate-500 shrink-0">${Ico.caret}</span>
                <span class="text-xs font-semibold text-slate-300 truncate">${escapeHtml(n.name)}</span>
                <div class="flex-1 h-1 bg-slate-700/30 rounded-full overflow-hidden mx-1 min-w-[40px]">
                  <div class="h-full rounded-full transition-all duration-500" style="width:${fp.weightedPct}%; background: linear-gradient(90deg, #818cf8, #34d399)"></div>
                </div>
                <span class="shrink-0">${circularProgressSVG(fp.weightedPct, 18, 3)}</span>
                <span class="text-[10px] text-slate-500 font-mono shrink-0">${fp.done}/${fp.total} · ${fmtDuration(fp.durationTotal)}</span>
                ${fp.weightedPct >= 100 ? `<span class="text-emerald-400 text-xs shrink-0">${Ico.check}</span>` : ''}
              </div>
              <div data-map-children="${escapeHtml(n.path)}" class="${isClosed ? 'hidden' : ''}">
                ${buildMap(n.children, depth + 1)}
              </div>
            </div>`;
        } else {
          if (['srt','vtt'].includes(n.type)) return '';
          const done = isDone(course, n.path);
          const pf = course.progress?.files?.[n.path];
          const dur = pf?.duration ? fmtDuration(pf.duration) : '';
          const pos = (pf?.position && pf?.duration) ? fmtDuration(Math.min(pf.position, pf.duration)) : '';
          const durStr2 = dur ? (pos && !done ? `${pos} / ${dur}` : dur) : '';
          return `
            <button onclick="window.openCourse('${course.id}', '${n.path.replace(/'/g,"\\'")}')" class="flex items-center gap-2 p-1 pl-7 rounded-lg hover:bg-white/5 transition-colors text-left w-full ${done ? 'opacity-60' : ''}">
              ${n.type === 'video' ? Ico.video : n.type === 'pdf' ? Ico.pdf : n.type === 'html' ? Ico.html : n.type === 'image' ? Ico.img : Ico.file}
              <span class="text-[11px] text-slate-300 truncate flex-1">${escapeHtml(n.name)}</span>
              <span class="text-[10px] text-slate-500 font-mono shrink-0">${durStr2}</span>
              <span class="shrink-0">${done ? `<span class="text-emerald-400">${Ico.check}</span>` : '<span class="text-slate-600 w-[14px]"></span>'}</span>
            </button>`;
        }
      }).join('')}
    </div>`;
  }

  return `
    <div class="glass-panel rounded-2xl p-4 md:p-5 ${mapAnimClass}">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-base font-bold text-slate-100 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-gradient-to-r from-indigo-400 to-purple-500 inline-block"></span>
          ${escapeHtml(course.name)}
        </h3>
        <span class="text-xs font-mono text-slate-400">${wPct}% · ${durStr}</span>
      </div>
      <div class="w-full h-2 bg-slate-700/30 rounded-full overflow-hidden mb-3">
        <div class="h-full rounded-full transition-all duration-700" style="width:${wPct}%; background: linear-gradient(90deg, #818cf8, #a78bfa, #34d399)"></div>
      </div>
      <div class="overflow-auto max-h-[28rem] pr-1 text-sm">
        ${buildMap(course.tree)}
      </div>
      <button onclick="window.openCourse('${course.id}')" class="mt-3 w-full btn-primary py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
        ${Ico.play} Resume Course
      </button>
    </div>`;
}

window.toggleFolderMap = (courseId, path) => {
  const c = state.courses.find(x => x.id === courseId);
  if (!c) return;
  if (!c.collapsed) c.collapsed = new Set();
  const isClosed = c.collapsed.has(path);
  if (isClosed) c.collapsed.delete(path);
  else c.collapsed.add(path);

  const folder = document.querySelector(`[data-map-course="${CSS.escape(courseId)}"][data-map-path="${CSS.escape(path)}"]`);
  if (!folder) return;
  const caret = folder.querySelector('.folder-caret');
  const children = folder.querySelector(`[data-map-children="${CSS.escape(path)}"]`);

  if (children) children.classList.toggle('hidden', !isClosed);
  if (caret) {
    caret.classList.toggle('closed', !isClosed);
    caret.classList.toggle('open', isClosed);
  }
};

function renderHeatmap(state) {
  const activity = state.user?.activity || {};
  const today = new Date();
  const days = [];
  
  for (let i = 119; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const mins = activity[dateStr] || 0;
    days.push({ date: dateStr, mins });
  }

  let cols = [];
  let curCol = [];
  days.forEach((day, i) => {
    curCol.push(day);
    if (curCol.length === 7 || i === days.length - 1) {
      cols.push(curCol);
      curCol = [];
    }
  });

  const getLevel = mins => {
    if (mins === 0) return 'bg-slate-800/50';
    if (mins < 30) return 'bg-indigo-900/60';
    if (mins < 60) return 'bg-indigo-700/80';
    if (mins < 120) return 'bg-indigo-500';
    return 'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]';
  };

  const gridHtml = cols.map(col => `
    <div class="flex flex-col gap-1.5">
      ${col.map(d => `<div class="w-3 h-3 md:w-3.5 md:h-3.5 rounded-sm ${getLevel(d.mins)} transition-all hover:scale-125 cursor-help" title="${d.date}: ${Math.round(d.mins)} mins"></div>`).join('')}
    </div>
  `).join('');

  return `
    <div class="glass-panel rounded-2xl p-5 mb-8 overflow-hidden relative group">
      <h3 class="text-sm font-semibold text-slate-300 mb-3 flex items-center justify-between">
        <span>Activity Heatmap</span>
        <span class="text-xs font-normal text-slate-500">${Math.round((state.user?.totalMinutes || 0) / 60)} total hrs</span>
      </h3>
      <div class="flex items-end gap-1.5 overflow-x-auto pb-2 custom-scrollbar">
        ${gridHtml}
      </div>
      <div class="flex items-center gap-2 mt-2 text-[10px] text-slate-500 justify-end">
        <span>Less</span>
        <div class="w-2.5 h-2.5 md:w-3 md:h-3 rounded-sm bg-slate-800/50"></div>
        <div class="w-2.5 h-2.5 md:w-3 md:h-3 rounded-sm bg-indigo-900/60"></div>
        <div class="w-2.5 h-2.5 md:w-3 md:h-3 rounded-sm bg-indigo-700/80"></div>
        <div class="w-2.5 h-2.5 md:w-3 md:h-3 rounded-sm bg-indigo-500"></div>
        <div class="w-2.5 h-2.5 md:w-3 md:h-3 rounded-sm bg-indigo-400"></div>
        <span>More</span>
      </div>
    </div>`;
}

/* ---------- All Bookmarks / All Notes sub-views ----------
 *
 * Aggregated cross-course views. The user can:
 *  - Search by label, file name, course name, folder name, or note text
 *  - Click a result to jump to the file (and timestamp for bookmarks)
 *
 * Bookmarks include both file-level saves (the "B" key) and
 * timestamp bookmarks (the "Shift+B" key). The result list is grouped
 * by course, then by folder, then by file.
 */
function setSubView(sub) {
  state.subView = sub;
  state.subViewQuery = '';
  render();
}

window.setSubView = setSubView;

function setSubViewQuery(q) {
  state.subViewQuery = q || '';
  render();
}
window.setSubViewQuery = setSubViewQuery;

function filterText(s) {
  return (s || '').toString().toLowerCase();
}

function pathFolder(path) {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.substring(0, idx) : '';
}

function fileBasename(path) {
  return path.split('/').pop();
}

function getSavedFiles(course) {
  const out = [];
  if (!course?.progress?.files) return out;
  for (const key in course.progress.files) {
    if (course.progress.files[key].saved) {
      out.push({ path: key, savedAt: course.progress.files[key].savedAt });
    }
  }
  return out;
}

function getBookmarkedFiles(course) {
  const out = [];
  if (!course?.progress?.files) return out;
  for (const key in course.progress.files) {
    const p = course.progress.files[key];
    if (p.bookmarks && p.bookmarks.length) {
      out.push({ path: key, bookmarks: p.bookmarks });
    }
  }
  return out;
}

function getNotedFiles(course) {
  const out = [];
  if (!course?.progress?.files) return out;
  for (const key in course.progress.files) {
    const p = course.progress.files[key];
    if (p.notes && p.notes.trim()) {
      out.push({ path: key, notes: p.notes, updatedAt: p.updatedAt || 0 });
    }
  }
  return out;
}

function buildAllBookmarksHtml(query) {
  const q = filterText(query);
  let totalMatches = 0;
  const sections = state.courses.map(course => {
    const savedFiles = getSavedFiles(course);
    const bookmarkedFiles = getBookmarkedFiles(course);
    const fileSet = new Set();
    savedFiles.forEach(s => fileSet.add(s.path));
    bookmarkedFiles.forEach(b => fileSet.add(b.path));
    if (fileSet.size === 0) return '';

    // Group files by folder.
    const folderMap = new Map();
    for (const p of fileSet) {
      const folder = pathFolder(p) || '(root)';
      if (!folderMap.has(folder)) folderMap.set(folder, []);
      folderMap.get(folder).push(p);
    }

    // Filter by query.
    const folderEntries = [...folderMap.entries()]
      .map(([folder, paths]) => {
        const fileRows = paths.map(p => {
          const baseName = fileBasename(p);
          const savedEntry = savedFiles.find(s => s.path === p);
          const bmEntry = bookmarkedFiles.find(b => b.path === p);
          const rowText = filterText(baseName + ' ' + folder + ' ' + (bmEntry?.bookmarks || []).map(b => b.label).join(' '));
          if (q && !rowText.includes(q)) return '';
          totalMatches++;
          const savedBadge = savedEntry ? `<span class="bm-pill bm-pill--saved" title="Saved file">${Ico.bookmarkFill} Saved</span>` : '';
          const bmList = (bmEntry?.bookmarks || []).map((b, i) => `
            <button onclick="window.jumpToBookmarkInCourse('${course.id}', '${escapeAttr(p)}', ${b.time})" class="bm-ts">
              <span class="bm-ts-time">${escapeHtml(b.label || fmtTime(b.time))}</span>
              <span class="bm-ts-arrow">${Ico.play}</span>
            </button>
          `).join('');
          return `
            <div class="bm-file">
              <div class="bm-file-head">
                <div class="bm-file-name">${escapeHtml(baseName)}</div>
                ${savedBadge}
                <button onclick="window.openCourse('${course.id}', '${escapeAttr(p)}')" class="bm-file-open" title="Open file at start">${Ico.play}</button>
              </div>
              ${bmList ? `<div class="bm-ts-list">${bmList}</div>` : ''}
            </div>`;
        }).join('');
        if (!fileRows) return '';
        return `
          <div class="bm-folder">
            <div class="bm-folder-head">${Ico.folder} ${escapeHtml(folder)}</div>
            <div class="bm-folder-body">${fileRows}</div>
          </div>`;
      })
      .join('');

    if (!folderEntries) return '';
    const stats = savedFiles.length + bookmarkedFiles.reduce((acc, b) => acc + b.bookmarks.length, 0);
    return `
      <div class="bm-course">
        <div class="bm-course-head" onclick="window.openCourse('${course.id}')">
          <div class="bm-course-title">${escapeHtml(course.name)}</div>
          <div class="bm-course-count">${savedFiles.length} saved · ${bookmarkedFiles.reduce((a, b) => a + b.bookmarks.length, 0)} timestamps</div>
        </div>
        <div class="bm-course-body">${folderEntries}</div>
      </div>`;
  }).join('');

  if (!sections) {
    return `<div class="rp-empty-state">${Ico.bookmark} <div class="mt-2 text-base">No bookmarks yet</div><div class="text-[12px] text-slate-500 mt-1">Press <kbd>B</kbd> to save a file or <kbd>Shift</kbd>+<kbd>B</kbd> in a video to add a timestamp.</div></div>`;
  }
  return sections;
}

function buildAllNotesHtml(query) {
  const q = filterText(query);
  let totalMatches = 0;
  const sections = state.courses.map(course => {
    const noted = getNotedFiles(course);
    if (!noted.length) return '';

    const folderMap = new Map();
    for (const n of noted) {
      const folder = pathFolder(n.path) || '(root)';
      if (!folderMap.has(folder)) folderMap.set(folder, []);
      folderMap.get(folder).push(n);
    }

    const folderEntries = [...folderMap.entries()].map(([folder, items]) => {
      const fileRows = items.map(n => {
        const baseName = fileBasename(n.path);
        const preview = n.notes.length > 220 ? n.notes.substring(0, 220) + '…' : n.notes;
        const hay = filterText(baseName + ' ' + folder + ' ' + n.notes);
        if (q && !hay.includes(q)) return '';
        totalMatches++;
        return `
          <div class="bm-file">
            <div class="bm-file-head">
              <div class="bm-file-name">${escapeHtml(baseName)}</div>
              <button onclick="window.openCourse('${course.id}', '${escapeAttr(n.path)}')" class="bm-file-open" title="Open file">${Ico.play}</button>
            </div>
            <div class="bm-note-preview">${escapeHtml(preview).replace(/\n/g, '<br>')}</div>
          </div>`;
      }).join('');
      if (!fileRows) return '';
      return `
        <div class="bm-folder">
          <div class="bm-folder-head">${Ico.folder} ${escapeHtml(folder)}</div>
          <div class="bm-folder-body">${fileRows}</div>
        </div>`;
    }).join('');

    if (!folderEntries) return '';
    return `
      <div class="bm-course">
        <div class="bm-course-head" onclick="window.openCourse('${course.id}')">
          <div class="bm-course-title">${escapeHtml(course.name)}</div>
          <div class="bm-course-count">${noted.length} note${noted.length === 1 ? '' : 's'}</div>
        </div>
        <div class="bm-course-body">${folderEntries}</div>
      </div>`;
  }).join('');

  if (!sections) {
    return `<div class="rp-empty-state">${Ico.note} <div class="mt-2 text-base">No notes yet</div><div class="text-[12px] text-slate-500 mt-1">Open a lesson and scroll to the Notes section to add one.</div></div>`;
  }
  return sections;
}

function escapeAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

window.jumpToBookmarkInCourse = (courseId, path, time) => {
  state.subView = null;
  state.subViewQuery = '';
  window.openCourse(courseId, path, time);
};

function renderSubViewShell(app, opts) {
  const { title, icon, query, html, placeholder, animate = true } = opts;
  const fadeClass = animate ? 'animate-fade-in' : '';
  app.innerHTML = `
    <div class="flex-1 overflow-auto ${fadeClass} custom-scrollbar">
      <div class="max-w-6xl mx-auto px-6 md:px-10 pt-8 md:pt-12 pb-10">
        <div class="flex items-center justify-between mb-6 gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <button onclick="window.setSubView(null)" class="p-2 rounded-lg hover:bg-white/10 text-slate-300 shrink-0" title="Back to dashboard">${Ico.arrowLeft}</button>
            <div class="min-w-0">
              <h1 class="text-2xl md:text-3xl font-bold text-slate-100 flex items-center gap-2 truncate">${icon} ${escapeHtml(title)}</h1>
              <p class="text-slate-400 text-sm">All your ${escapeHtml(title.toLowerCase())} across every course, organized by folder.</p>
            </div>
          </div>
        </div>
        <div class="mb-6">
          <div class="relative max-w-xl">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">${Ico.search}</span>
            <input id="subview-search" type="text" value="${escapeAttr(query || '')}" placeholder="${escapeAttr(placeholder)}" class="w-full bg-slate-900/50 border border-white/10 rounded-xl pl-10 pr-3 py-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50" autofocus>
          </div>
        </div>
        ${html}
      </div>
    </div>
  `;
  const search = document.getElementById('subview-search');
  if (search) {
    search.addEventListener('input', (e) => setSubViewQuery(e.target.value));
  }
}

export function renderAllBookmarks(app, { animate = true } = {}) {
  cleanupMedia();
  const html = buildAllBookmarksHtml(state.subViewQuery);
  renderSubViewShell(app, {
    title: 'All Bookmarks',
    icon: Ico.bookmark,
    query: state.subViewQuery,
    html,
    placeholder: 'Search by file, course, or folder…',
    animate
  });
}

export function renderAllNotes(app, { animate = true } = {}) {
  cleanupMedia();
  const html = buildAllNotesHtml(state.subViewQuery);
  renderSubViewShell(app, {
    title: 'All Notes',
    icon: Ico.note,
    query: state.subViewQuery,
    html,
    placeholder: 'Search notes by content, file, or course…',
    animate
  });
}

export function renderDashboard(app, { animate = true } = {}) {
  cleanupMedia();
  const fadeClass = animate ? 'animate-fade-in' : '';
  const stats = computeDashboardStats();
  const envWarning = state.environmentWarning && !state.environmentWarningDismissed ? `
    <div class="mb-6 glass-panel rounded-2xl p-4 md:p-5 border border-amber-400/20 bg-amber-500/10">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 w-8 h-8 rounded-full bg-amber-400/15 text-amber-300 flex items-center justify-center font-black shrink-0">!</div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-amber-100">Desktop browser required</div>
          <p class="text-sm text-amber-100/80 mt-1 leading-relaxed">
            ${escapeHtml(state.environmentWarning)}
          </p>
        </div>
        <button onclick="window.dismissEnvironmentWarning()" class="p-2 rounded-lg hover:bg-white/10 text-amber-100/80 shrink-0" title="Dismiss">${Ico.close}</button>
      </div>
    </div>` : '';
  const coursesHtml = state.courses.map(c => {
    const p = overallCourseProgress(c);
    const durStr = p.durationTotal ? `${fmtDuration(p.durationDone)} / ${fmtDuration(p.durationTotal)}` : '';
    const idx = state.indexingStatus?.[c.id];
    const isIndexing = idx && !idx.done && idx.total > 0 && idx.indexed < idx.total;
    const indexPct = idx && idx.total > 0 ? Math.round((idx.indexed / idx.total) * 100) : 100;
    return `
      <div class="card-hover glass-panel rounded-2xl p-5 md:p-6 relative group cursor-pointer" onclick="window.openCourse('${c.id}')">
        <button onclick="event.stopPropagation(); window.removeCourse('${c.id}')" class="absolute top-3 right-3 p-2 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 transition-opacity z-10" title="Remove">${Ico.file}</button>
        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30 text-white">
          ${Ico.play}
        </div>
        <h3 class="text-lg font-semibold text-slate-100 mb-1 line-clamp-1">${escapeHtml(c.name)}</h3>
        <p class="text-sm text-slate-400 mb-2">${c.flatFiles ? c.flatFiles.length : '?'} lessons · ${durStr}</p>
        <div class="flex items-center gap-3">
          <div class="flex-1 h-2 bg-slate-700/50 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-700" style="width:${p.weightedPct}%; background: linear-gradient(90deg, #818cf8, #34d399)"></div>
          </div>
          <span class="text-sm font-medium text-slate-300 w-10 text-right">${p.weightedPct}%</span>
        </div>
        ${isIndexing ? `<div class="mt-3 flex items-center gap-2 text-[11px] text-indigo-300/80 font-medium">
          <span class="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
          <span>Indexing durations ${idx.indexed}/${idx.total}</span>
          <div class="flex-1 h-1 bg-slate-700/40 rounded-full overflow-hidden ml-1">
            <div class="h-full bg-indigo-400/80 transition-all duration-500" style="width:${indexPct}%"></div>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');

  const mapHtml = state.courses.map(c => renderCourseMap(c)).join('');

  const bookmarksHtml = getAllBookmarks(8).map(b => `
    <button onclick="window.openCourse('${b.courseId}', '${b.path}', ${b.time || 0})" class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors border border-white/5 mb-2">
      <div class="text-xs text-indigo-300 font-medium line-clamp-1">${escapeHtml(b.label)}</div>
      <div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(b.courseName)} · ${b.time ? fmtTime(b.time) : 'file'}</div>
    </button>
  `).join('');

  const notesHtml = getAllNotes(8).map(n => `
    <button onclick="window.openCourse('${n.courseId}', '${n.path}')" class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors border border-white/5 mb-2">
      <div class="text-xs text-slate-300 line-clamp-2">${escapeHtml(n.text)}</div>
      <div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(n.courseName)} · ${escapeHtml(n.title)}</div>
    </button>
  `).join('');

  app.innerHTML = `
    <div class="flex-1 overflow-auto ${fadeClass} custom-scrollbar">
      <div class="relative overflow-hidden px-6 md:px-10 pt-8 md:pt-12 pb-6">
        <div class="max-w-6xl mx-auto">
          ${envWarning}
          <div class="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <div class="flex items-center gap-3 mb-3">
                <img src="icon-32.png" alt="" aria-hidden="true" class="w-8 h-8 md:w-10 md:h-10 rounded-lg shrink-0 shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
                <h1 class="text-4xl md:text-6xl font-extrabold text-gradient tracking-tight inline-flex items-center gap-2">
                  <span>Welcome,</span>
                  <span
                    id="username-name-slot"
                    class="inline-flex items-center rounded-lg px-1.5 py-0.5 -mx-1.5 cursor-text hover:bg-white/5 transition-colors"
                    onclick="window.editUsername()"
                    title="Click to edit username"
                  >${escapeHtml(state.user?.name || 'Learner')}</span>
                </h1>
              </div>
              <p class="text-slate-400 text-lg md:text-xl max-w-2xl leading-relaxed">Your offline learning sanctuary. Track progress, take notes, and never lose your place.</p>
            </div>
            <div class="flex items-center gap-4 text-sm text-slate-400">
              <div class="flex flex-col items-center">
                <span class="text-2xl font-bold text-orange-400 flex items-center gap-1">${Ico.check || '🔥'} ${state.user?.streak || 0}</span>
                <span class="text-[10px] uppercase tracking-wider">Current Streak</span>
              </div>
              <div class="w-px h-10 bg-slate-700/50"></div>
              <div class="flex flex-col items-center">
                <span class="text-2xl font-bold text-slate-300 flex items-center gap-1">${Ico.check || '🏆'} ${state.user?.highestStreak || 0}</span>
                <span class="text-[10px] uppercase tracking-wider">Highest Streak</span>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-3 mb-8">
            <button onclick="window.pickCourseFolder()" class="btn-primary px-5 py-3 rounded-xl font-medium flex items-center gap-2 text-sm md:text-base pulse-glow cursor-pointer transition-transform hover:scale-[1.02]">
              ${Ico.plus} Add Course Folder
            </button>
            <button onclick="window.setSubView('all-bookmarks')" class="btn-ghost px-5 py-3 rounded-xl font-medium text-sm md:text-base flex items-center gap-2 hover:bg-white/10">
              ${Ico.bookmarkFill} All Bookmarks
            </button>
            <button onclick="window.setSubView('all-notes')" class="btn-ghost px-5 py-3 rounded-xl font-medium text-sm md:text-base flex items-center gap-2 hover:bg-white/10">
              ${Ico.note} All Notes
            </button>
            <button onclick="window.exportAllProgress()" class="btn-ghost px-5 py-3 rounded-xl font-medium text-sm md:text-base flex items-center gap-2 hover:bg-white/10">
              ${Ico.download} Export All
            </button>
            <button onclick="window.importAllProgress()" class="btn-ghost px-5 py-3 rounded-xl font-medium text-sm md:text-base flex items-center gap-2 hover:bg-white/10">
              ${Ico.upload} Import
            </button>
          </div>
          
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-white">${stats.courses}</div><div class="text-xs text-slate-400 mt-1">Courses</div></div>
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-emerald-400">${stats.completed}</div><div class="text-xs text-slate-400 mt-1">Completed</div></div>
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-indigo-400">${stats.notes}</div><div class="text-xs text-slate-400 mt-1">Notes</div></div>
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-amber-400">${stats.bookmarks}</div><div class="text-xs text-slate-400 mt-1">Bookmarks</div></div>
          </div>
          
          ${renderHeatmap(state)}
        </div>
      </div>

      <div class="max-w-6xl mx-auto px-6 md:px-10 pb-10 space-y-6">
        <h2 class="text-xl font-bold text-slate-100 mb-2">Your Courses</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 mb-6">
          ${coursesHtml || `<div class="text-slate-500 text-sm">No courses yet.</div>`}
        </div>
        
        ${mapHtml ? `<h2 class="text-xl font-bold text-slate-100 mb-2 mt-8">Progress Map</h2><div class="grid grid-cols-1 gap-5">${mapHtml}</div>` : ''}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 mt-8">
          <div class="glass-panel rounded-2xl p-5">
            <div class="flex items-center justify-between mb-3 gap-2">
              <h3 class="text-lg font-semibold text-slate-100 flex items-center gap-2">${Ico.bookmarkFill || Ico.bookmark} Recent Bookmarks</h3>
              <button onclick="window.setSubView('all-bookmarks')" class="text-[11px] text-indigo-300 hover:text-indigo-200 font-semibold uppercase tracking-wider shrink-0">View all →</button>
            </div>
            <div class="max-h-64 overflow-auto pr-1 space-y-1 custom-scrollbar">
              ${bookmarksHtml || `<div class="text-slate-500 text-sm">No bookmarks yet.</div>`}
            </div>
          </div>
          <div class="glass-panel rounded-2xl p-5">
            <div class="flex items-center justify-between mb-3 gap-2">
              <h3 class="text-lg font-semibold text-slate-100 flex items-center gap-2">${Ico.note} Recent Notes</h3>
              <button onclick="window.setSubView('all-notes')" class="text-[11px] text-indigo-300 hover:text-indigo-200 font-semibold uppercase tracking-wider shrink-0">View all →</button>
            </div>
            <div class="max-h-64 overflow-auto pr-1 space-y-1 custom-scrollbar">
              ${notesHtml || `<div class="text-slate-500 text-sm">No notes yet.</div>`}
            </div>
          </div>
        </div>

        <!-- Footer / Authors -->
        <div class="mt-16 pt-6 border-t border-slate-700/50 flex flex-col md:flex-row items-center justify-between text-slate-500 text-sm">
          <p>Lumina v2 &copy; ${new Date().getFullYear()}</p>
          <div class="flex gap-4 mt-4 md:mt-0">
            <a href="https://github.com/rayedriasat" target="_blank" class="hover:text-indigo-400 transition-colors">GitHub</a>
            <a href="https://www.linkedin.com/in/rayed-riasat-rabbi" target="_blank" class="hover:text-indigo-400 transition-colors">LinkedIn</a>
          </div>
        </div>
      </div>
    </div>`;
}

export function renderPlayer(app) {
  cleanupMedia();
  app.innerHTML = `
    <div class="flex-1 flex flex-col min-h-0 bg-black/20 relative" id="player-shell">
      <div class="h-14 glass-strong flex items-center justify-between px-3 md:px-4 shrink-0 z-20" id="topbar"></div>
      <div class="flex-1 flex min-h-0 overflow-hidden">
        <div id="sidebar" class="shrink-0 z-10"></div>
        <div class="flex-1 flex min-h-0 overflow-hidden relative">
          <main id="content-area" class="flex-1 min-w-0 overflow-y-auto flex flex-col bg-black/10">
            <div id="viewer-wrap" class="shrink-0 relative"></div>
            <div id="mobile-subtitles" class="md:hidden shrink-0"></div>
            <div id="notes-section" class="shrink-0"></div>
          </main>
          <div id="right-panel" class="hidden"></div>
        </div>
      </div>
      <div id="mobile-overlay" onclick="window.toggleMobileSidebar()" class="hidden md:hidden fixed inset-0 z-30 mobile-overlay"></div>
    </div>
  `;
  updateSidebar(); updateTopBar(); renderSubtitles();
}

export function updateTopBar() {
  const el = document.getElementById('topbar');
  if (!el || state.view !== 'player') return;
  const c = state.currentCourse;
  const cur = state.currentFile;
  const done = c && cur ? isDone(c, cur.path) : false;
  const p = c ? overallCourseProgress(c) : {};
  const durDisplay = p.durationTotal ? `${fmtDuration(p.durationDone)} / ${fmtDuration(p.durationTotal)}` : '';
  const progressPct = p.weightedPct || 0;
  const hasSubs = state.cueData.length > 0 && cur?.type === 'video';
  const hasBookmarks = c && cur ? isFileSaved(c, cur.path) || (c.progress?.files?.[cur.path]?.bookmarks?.length > 0) : false;
  const showRightToggle = hasSubs || hasBookmarks;
  const rightPanelOpen = state.rightPanelOpen && showRightToggle;
  el.innerHTML = `
    <div class="flex items-center gap-2 md:gap-3 overflow-hidden min-w-0">
      <button onclick="window.backToDashboard()" class="p-2 rounded-lg hover:bg-white/10 text-slate-300 shrink-0" title="Dashboard">${Ico.arrowLeft}</button>
      <button onclick="window.toggleDesktopSidebar()" class="hidden md:flex p-2 rounded-lg hover:bg-white/10 text-slate-300 shrink-0" title="Toggle sidebar">${Ico.menu}</button>
      <button onclick="window.toggleMobileSidebar()" class="md:hidden p-2 rounded-lg hover:bg-white/10 text-slate-300 shrink-0" title="Menu">${Ico.menu}</button>
      <div class="min-w-0">
        <div class="text-sm md:text-base font-semibold text-slate-100 truncate">${escapeHtml(c?.name || '')}</div>
        <div class="text-[11px] md:text-xs text-slate-400 truncate">${escapeHtml(cur?.name || 'Select a lesson')}</div>
      </div>
    </div>
    <div class="flex items-center gap-2 md:gap-3 shrink-0 pl-2">
      <div class="hidden md:flex flex-col items-end gap-1 min-w-[140px]">
        <span class="text-xs text-slate-500 font-medium whitespace-nowrap">${durDisplay}</span>
        <div class="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden" style="min-width: 120px;">
          <div class="h-full rounded-full transition-all duration-500" style="width:${progressPct}%; background: linear-gradient(90deg, #818cf8, #34d399)"></div>
        </div>
      </div>
      <button onclick="window.prevFile()" class="btn-ghost p-2 rounded-lg" title="Previous">${Ico.prev}</button>
      <button onclick="window.toggleComplete()" class="${done ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'btn-ghost text-slate-300'} px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors" id="btn-complete" title="Toggle complete (C)">
        ${done ? '✓ Completed' : 'Mark Complete'}
      </button>
      ${showRightToggle ? `<button onclick="window.toggleRightPanel()" class="btn-ghost p-2 rounded-lg ${rightPanelOpen ? 'text-indigo-200 bg-indigo-500/15' : 'text-indigo-300'}" title="Right panel" aria-pressed="${rightPanelOpen}">${Ico.panelRight}</button>` : ''}
      <button onclick="window.nextFile()" class="btn-ghost p-2 rounded-lg" title="Next">${Ico.next}</button>
    </div>
  `;
}

// --- Sidebar helpers ---
function sidebarItemIcon(n) {
  if (n.type === 'video') return Ico.video;
  if (n.type === 'pdf') return Ico.pdf;
  if (n.type === 'html') return Ico.html;
  if (n.type === 'image') return Ico.img;
  return Ico.file;
}

function fileDurationDisplay(course, path) {
  const pf = course.progress?.files?.[path];
  if (!pf || !pf.duration) return '';
  const dur = fmtDuration(pf.duration);
  const pos = pf.position ? fmtDuration(Math.min(pf.position, pf.duration)) : '';
  return pos ? `${pos} / ${dur}` : dur;
}

function fileDurationHtml(course, path) {
  const text = fileDurationDisplay(course, path);
  if (!text) return '';
  return `<span class="text-[10px] text-slate-500 font-mono shrink-0 mr-2">${text}</span>`;
}

export function updateSidebar() {
  const el = document.getElementById('sidebar');
  if (!el || state.view !== 'player') return;
  const c = state.currentCourse;
  if (!c) return;

  const scrollHost = el.querySelector('#sidebar-content');
  const scrollTop = scrollHost ? scrollHost.scrollTop : 0;
  const scrollLeft = scrollHost ? scrollHost.scrollLeft : 0;

  const isMob = state.isMobile;
  if (!isMob) {
    if (state.sidebarOpen) {
      el.className = 'shrink-0 glass border-r border-white/10 flex flex-col h-full relative';
      el.style.width = (state.sidebarWidth || 280) + 'px';
      el.style.minWidth = (state.sidebarWidth || 280) + 'px';
    } else {
      el.className = 'hidden';
      el.style.width = '';
      el.style.minWidth = '';
    }
  } else {
    el.className = `fixed inset-y-0 left-0 z-40 w-80 glass border-r border-white/10 flex flex-col h-full transform transition-transform duration-300 ${state.mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`;
    el.style.width = '20rem';
    el.style.minWidth = '20rem';
  }

  const courseStats = overallCourseProgress(c);

  const build = (nodes, level = 0) => {
    const indent = level * 2;
    const showTreeLine = level > 0;
    return nodes.map((n, i, arr) => {
      const isLast = i === arr.length - 1;
      if (n.kind === 'directory') {
        const isClosed = c.collapsed.has(n.path);
        const fp = folderProgress(n, c);
        const fDone = isFolderDone(n, c);
        const watched = fp.durationDone > 0 ? fmtDuration(fp.durationDone) : '0s';
        const total = fp.durationTotal > 0 ? fmtDuration(fp.durationTotal) : '0s';
        const durStr = `${watched} / ${total}`;
        const folderPct = fp.weightedPct;
        const showProgress = folderPct > 0;
        const progressSvg = showProgress ? circularProgressSVG(folderPct, 16, 2.5) : '';
        return `
          <div class="sidebar-dir" data-path="${n.path.replace(/"/g, '&quot;')}">
            <div class="flex gap-1 py-1 text-slate-300 hover:bg-white/5 cursor-pointer select-none transition-colors rounded" style="padding-left:${indent}px" title="${escapeHtml(n.name)}" data-tree-line="${showTreeLine && !isLast}">
              <div class="flex flex-col items-center justify-center shrink-0 w-6 h-10">
                <span class="folder-caret ${isClosed?'closed':'open'} text-slate-500 text-[10px]">${Ico.caret}</span>
                <button onclick="event.stopPropagation(); window.toggleFolderDone('${n.path.replace(/'/g,"\\'")}')" class="shrink-0 w-6 h-6 flex items-center justify-center p-0 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400 transition-colors mt-0.5" title="Toggle folder complete" aria-label="Toggle folder complete">
                  ${fDone ? `<span class="text-emerald-400 text-[10px]">${Ico.check}</span>` : progressSvg || `<span class="text-slate-400 text-[10px]">${Ico.circle}</span>`}
                </button>
              </div>
              <div onclick="window.toggleFolder('${n.path.replace(/'/g,"\\'")}')" class="flex-1 min-w-0 cursor-pointer" title="${escapeHtml(n.name)}">
                <div class="flex items-start gap-1 text-[11px] font-medium" style="white-space: nowrap; overflow: visible;">
                  <span class="text-slate-400 shrink-0 text-[10px] p-0.5">${Ico.folder}</span>
                  <div class="min-w-0">
                    <span class="truncate block">${escapeHtml(n.name)}</span>
                    ${durStr ? `<span class="text-[9px] text-slate-500 font-mono block mt-0.5">${durStr}</span>` : ''}
                  </div>
                </div>
              </div>
            </div>
            <div class="tree-children ${isClosed?'hidden':''}" style="padding-left:${indent + 2}px; border-left: 1px solid rgba(255,255,255,0.03); margin-left: 3px;">${build(n.children, level+1)}</div>
          </div>`;
      } else {
        if (['srt','vtt'].includes(n.type)) return '';
        const active = state.currentFile?.path === n.path ? 'active' : '';
        const done = isDone(c, n.path);
        const pf = c.progress?.files?.[n.path];
        const dur = pf?.duration ? fmtDuration(pf.duration) : '';
        const pos = pf?.position ? fmtDuration(Math.min(pf.position, pf.duration)) : '0s';
        const durStr = dur ? `${pos} / ${dur}` : '';
        return `
          <div class="flex gap-1 py-1 sidebar-file" data-path="${n.path.replace(/"/g, '&quot;')}" style="padding-left:${indent + 10}px" data-tree-line="${showTreeLine && !isLast}">
            <button onclick="event.stopPropagation(); window.toggleDoneSidebar('${n.path.replace(/'/g,"\\'")}')" class="shrink-0 w-6 h-10 flex flex-col items-center justify-center p-0 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400 transition-opacity" title="Toggle complete" aria-label="Toggle complete">
              ${done ? `<span class="text-emerald-400 text-[10px]">${Ico.check}</span>` : `<span class="text-slate-400 text-[10px]">${Ico.circle}</span>`}
            </button>
            <div onclick="window.loadFileByPath('${n.path.replace(/'/g,"\\'")}')" class="file-item flex-1 min-w-0 cursor-pointer select-none ${active}" title="${escapeHtml(n.name)}">
              <div class="flex items-start gap-1 text-[11px]" style="white-space: nowrap; overflow: visible;">
                <span class="text-slate-400 shrink-0 text-[10px] p-0.5">${sidebarItemIcon(n)}</span>
                <div class="min-w-0">
                  <span class="truncate block">${escapeHtml(n.name)}</span>
                  ${durStr ? `<span class="text-[9px] text-slate-500 font-mono block mt-0.5">${durStr}</span>` : ''}
                </div>
              </div>
            </div>
          </div>`;
      }
    }).join('');
  };

  const durDone = fmtDuration(courseStats.durationDone);
  const durTotal = fmtDuration(courseStats.durationTotal);

  el.innerHTML = `
    <aside class="flex flex-col h-full w-full relative ${!isMob ? 'z-50' : ''}">
      ${!isMob ? `<div id="sidebar-resizer" class="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-indigo-500/60 transition-colors z-50" title="Drag to resize"></div>` : ''}
      <div class="h-14 glass-strong flex items-center justify-between px-3 md:px-4 shrink-0">
        <span class="font-semibold text-slate-200 text-sm md:text-base">Course</span>
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-slate-400 font-mono hidden sm:inline">${durDone} / ${durTotal}</span>
          <button onclick="window.collapseAll()" class="p-1.5 rounded hover:bg-white/10 text-slate-400" title="Collapse All">${Ico.collapse}</button>
          <span class="text-[11px] text-emerald-400 font-medium bg-emerald-400/10 px-2 py-1 rounded-full">${courseStats.weightedPct}%</span>
        </div>
      </div>
      <div id="sidebar-content" class="flex-1 overflow-x-auto overflow-y-auto py-2 text-[13px] md:text-sm" style="white-space: nowrap;">
        <div class="sidebar-inner min-w-full" style="min-width: max(100%, 500px);">${build(c.tree)}</div>
      </div>
      ${isMob ? `
      <div class="p-3 border-t border-white/10 shrink-0">
        <button onclick="window.toggleMobileSidebar()" class="w-full py-2 rounded-lg bg-white/10 text-sm text-slate-300 hover:bg-white/20 transition-colors">Close Sidebar</button>
      </div>` : ''}
    </aside>
  `;

  if (!isMob) {
    const resizer = document.getElementById('sidebar-resizer');
    if (resizer) {
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = state.sidebarWidth || 340;
        const onMove = (ev) => {
          const newWidth = Math.max(240, Math.min(560, startWidth + ev.clientX - startX));
          state.sidebarWidth = newWidth;
          el.style.width = newWidth + 'px';
          el.style.minWidth = newWidth + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
  }

  const restoredScrollHost = el.querySelector('#sidebar-content');
  if (restoredScrollHost) {
    restoredScrollHost.scrollTop = scrollTop;
    restoredScrollHost.scrollLeft = scrollLeft;
  }

  const overlay = document.getElementById('mobile-overlay');
  if (overlay) {
    if (isMob && state.mobileSidebarOpen) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
  }
}

export function updateSidebarSelection(previousPath, currentPath) {
  const clearActive = (path) => {
    if (!path) return;
    const prevItem = document.querySelector(`.sidebar-file[data-path="${CSS.escape(path)}"] .file-item`);
    if (prevItem) prevItem.classList.remove('active');
  };

  const setActive = (path) => {
    if (!path) return;
    const nextItem = document.querySelector(`.sidebar-file[data-path="${CSS.escape(path)}"] .file-item`);
    if (nextItem) nextItem.classList.add('active');
  };

  if (previousPath && previousPath !== currentPath) clearActive(previousPath);
  setActive(currentPath);
}

// --- Surgical sidebar updates (no full re-render) ---
function updateSidebarFile(path) {
  const item = document.querySelector(`.sidebar-file[data-path="${CSS.escape(path)}"]`);
  if (!item) return;
  const course = state.currentCourse;
  const done = isDone(course, path);
  const btn = item.querySelector('button[title="Toggle complete"]');
  if (btn) btn.innerHTML = done ? `<span class="text-emerald-400">${Ico.check}</span>` : Ico.circle;
  const pf = course.progress?.files?.[path];
  const dur = pf?.duration ? fmtDuration(pf.duration) : '';
  const pos = pf?.position ? fmtDuration(Math.min(pf.position, pf.duration)) : '0s';
  const durStr = dur ? `${pos} / ${dur}` : '';
  const durEl = item.querySelector('.file-item > div > div > span:last-child');
  if (durEl && durEl.classList.contains('font-mono')) {
    durEl.textContent = durStr;
  } else {
    const nameEl = item.querySelector('.file-item .truncate.block');
    if (nameEl && nameEl.nextElementSibling) {
      nameEl.nextElementSibling.textContent = durStr;
    }
  }
  updateAncestorFolders(path);
}

function updateAncestorFolders(path) {
  const course = state.currentCourse;
  let curPath = '';
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    curPath = curPath ? `${curPath}/${parts[i]}` : parts[i];
    const dirEl = document.querySelector(`.sidebar-dir[data-path="${CSS.escape(curPath)}"]`);
    if (dirEl) {
      const node = findNode(course.tree, curPath);
      if (node) {
        const fp = folderProgress(node, course);
        const fDone = isFolderDone(node, course);
        const badge = dirEl.querySelector('.sidebar-folder-progress');
        if (badge) badge.innerHTML = `${fmtDuration(fp.durationDone)} / ${fmtDuration(fp.durationTotal)}`;
        const btn = dirEl.querySelector('button[title="Toggle folder complete"]');
        if (btn) {
          const showProgress = fp.weightedPct > 0;
          const progressSvg = showProgress ? circularProgressSVG(fp.weightedPct, 16, 2.5) : '';
          btn.innerHTML = fDone ? `<span class="text-emerald-400 text-[10px]">${Ico.check}</span>` : progressSvg || `<span class="text-slate-400 text-[10px]">${Ico.circle}</span>`;
        }
      }
    }
  }
}

function findNode(nodes, path) {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function toggleFolder(path) {
  const c = state.currentCourse;
  if (!c) return;
  if (!c.collapsed) c.collapsed = new Set();
  if (c.collapsed.has(path)) c.collapsed.delete(path);
  else c.collapsed.add(path);
  updateSidebar();
}

export function collapseAll() {
  const c = state.currentCourse;
  if (!c || !c.tree) return;
  const collect = (nodes) => {
    for (const n of nodes) {
      if (n.kind === 'directory') {
        c.collapsed.add(n.path);
        if (n.children) collect(n.children);
      }
    }
  };
  collect(c.tree);
  updateSidebar();
}

export function toggleDoneSidebar(path) {
  const c = state.currentCourse;
  if (!c) return;
  const val = !isDone(c, path);
  if (!c.progress.files[path]) c.progress.files[path] = {};
  const fileProgress = c.progress.files[path];
  fileProgress.completed = val;
  if (val) {
    fileProgress.position = fileProgress.duration || 0;
  } else {
    fileProgress.position = 0;
  }
  window.dispatchEvent(new CustomEvent('lumina-toggle-done', { detail: { courseId: c.id, path, val } }));
  updateSidebarFile(path);
  updateTopBar();
}

export function toggleFolderDone(path) {
  const c = state.currentCourse;
  if (!c) return;
  const node = findNode(c.tree, path);
  if (!node) return;
  const files = getDescendantFiles(node);
  const targetVal = !isFolderDone(node, c);
  for (const f of files) {
    if (!c.progress.files[f.path]) c.progress.files[f.path] = {};
    const fileProgress = c.progress.files[f.path];
    fileProgress.completed = targetVal;
    if (targetVal) {
      fileProgress.position = fileProgress.duration || 0;
    } else {
      fileProgress.position = 0;
    }
  }
  window.dispatchEvent(new CustomEvent('lumina-toggle-done', { detail: { courseId: c.id, path, val: targetVal, batch: true } }));
  for (const f of files) updateSidebarFile(f.path);
  updateTopBar();
}

window.toggleFolderDone = toggleFolderDone;

export function toggleDesktopSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  updateSidebar();
}

export function toggleMobileSidebar() {
  state.mobileSidebarOpen = !state.mobileSidebarOpen;
  updateSidebar();
}

export function backToDashboard() {
  cleanupMedia();
  state.view = 'dashboard';
  state.subView = null;
  state.subViewQuery = '';
  state.currentCourse = null;
  state.currentFile = null;
  state.editingUsername = false;
  state.usernameDraft = '';
  state.sidebarOpen = true;
  state.mobileSidebarOpen = false;
  render();
}
