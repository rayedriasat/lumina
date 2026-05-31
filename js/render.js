import { state } from './state.js';
import { Ico } from './icons.js';
import { escapeHtml, fmtTime, fmtDuration, overallCourseProgress, folderProgress, isFolderDone, getDescendantFiles, flattenAll, circularProgressSVG } from './fs.js';
import { overallProgress, isDone, cleanupMedia, loadFile, renderSubtitles, toggleComplete, loadFileByPath, nextFile, prevFile, setDone } from './player.js';

export function render() {
  const app = document.getElementById('app');
  if (!app) return;
  if (state.view !== state.lastRenderView) {
    state.lastRenderView = state.view;
    if (state.view === 'dashboard') renderDashboard(app);
    else if (state.view === 'player') renderPlayer(app);
  } else if (state.view === 'player') {
    updateSidebar(); updateTopBar(); renderSubtitles();
  }
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
function renderCourseMap(course) {
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
            <div class="group cursor-pointer select-none">
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
              ${isClosed ? '' : buildMap(n.children, depth + 1)}
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
    <div class="glass-panel rounded-2xl p-4 md:p-5 animate-fade-in">
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
  if (c.collapsed.has(path)) c.collapsed.delete(path);
  else c.collapsed.add(path);
  render();
};

export function renderDashboard(app) {
  cleanupMedia();
  const stats = computeDashboardStats();
  const coursesHtml = state.courses.map(c => {
    const p = overallCourseProgress(c);
    const durStr = p.durationTotal ? `${fmtDuration(p.durationDone)} / ${fmtDuration(p.durationTotal)}` : '';
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
    <div class="flex-1 overflow-auto animate-fade-in">
      <div class="relative overflow-hidden px-6 md:px-10 pt-8 md:pt-12 pb-6">
        <div class="max-w-6xl mx-auto">
          <h1 class="text-4xl md:text-6xl font-extrabold text-gradient mb-3 tracking-tight">Lumina</h1>
          <p class="text-slate-400 text-lg md:text-xl max-w-2xl leading-relaxed mb-8">Your offline learning sanctuary. Track progress, take notes, and never lose your place.</p>
          <div class="flex flex-wrap gap-3 mb-8">
            <button onclick="window.pickCourseFolder()" class="btn-primary px-5 py-3 rounded-xl font-medium flex items-center gap-2 text-sm md:text-base pulse-glow">
              ${Ico.plus} Add Course Folder
            </button>
            <button onclick="window.exportAllProgress()" class="btn-ghost px-5 py-3 rounded-xl font-medium text-sm md:text-base flex items-center gap-2">
              ${Ico.download} Export All
            </button>
            <button onclick="window.importAllProgress()" class="btn-ghost px-5 py-3 rounded-xl font-medium text-sm md:text-base flex items-center gap-2">
              ${Ico.upload} Import
            </button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-white">${stats.courses}</div><div class="text-xs text-slate-400 mt-1">Courses</div></div>
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-emerald-400">${stats.completed}</div><div class="text-xs text-slate-400 mt-1">Completed</div></div>
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-indigo-400">${stats.notes}</div><div class="text-xs text-slate-400 mt-1">Notes</div></div>
            <div class="glass-panel rounded-xl p-4 text-center"><div class="text-2xl font-bold text-amber-400">${stats.bookmarks}</div><div class="text-xs text-slate-400 mt-1">Bookmarks</div></div>
          </div>
        </div>
      </div>
      <div class="max-w-6xl mx-auto px-6 md:px-10 pb-10 space-y-6">
        <h2 class="text-xl font-bold text-slate-100 mb-2">Your Courses</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 mb-6">
          ${coursesHtml || `<div class="text-slate-500 text-sm">No courses yet.</div>`}
        </div>
        ${mapHtml ? `<h2 class="text-xl font-bold text-slate-100 mb-2">Progress Map</h2><div class="grid grid-cols-1 gap-5">${mapHtml}</div>` : ''}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          <div class="glass-panel rounded-2xl p-5">
            <h3 class="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">${Ico.bookmarkFill || Ico.bookmark} Recent Bookmarks</h3>
            <div class="max-h-64 overflow-auto pr-1 space-y-1">
              ${bookmarksHtml || `<div class="text-slate-500 text-sm">No bookmarks yet.</div>`}
            </div>
          </div>
          <div class="glass-panel rounded-2xl p-5">
            <h3 class="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">${Ico.note} Recent Notes</h3>
            <div class="max-h-64 overflow-auto pr-1 space-y-1">
              ${notesHtml || `<div class="text-slate-500 text-sm">No notes yet.</div>`}
            </div>
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
  const hasSubs = state.cueData.length > 0 && cur?.type === 'video';
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
      <span class="hidden md:inline text-xs text-slate-500 font-medium whitespace-nowrap">${durDisplay}</span>
      <button onclick="window.prevFile()" class="btn-ghost p-2 rounded-lg" title="Previous">${Ico.prev}</button>
      <button onclick="window.toggleComplete()" class="${done ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'btn-ghost text-slate-300'} px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors" id="btn-complete" title="Toggle complete (C)">
        ${done ? '✓ Completed' : 'Mark Complete'}
      </button>
      <button onclick="window.addBookmark()" class="btn-ghost p-2 rounded-lg text-amber-400" title="Bookmark (B)">${Ico.bookmark}</button>
      ${hasSubs ? `<button onclick="window.toggleRightPanel()" class="btn-ghost p-2 rounded-lg text-indigo-300" title="Subtitles">${Ico.search}</button>` : ''}
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
  if (pos) return `<span class="text-[10px] text-slate-500 font-mono ml-1 whitespace-nowrap">${pos} / ${dur}</span>`;
  return `<span class="text-[10px] text-slate-500 font-mono ml-1 whitespace-nowrap">${dur}</span>`;
}

export function updateSidebar() {
  const el = document.getElementById('sidebar');
  if (!el || state.view !== 'player') return;
  const c = state.currentCourse;
  if (!c) return;

  const isMob = state.isMobile;
  if (!isMob) {
    if (state.sidebarOpen) {
      el.className = 'shrink-0 glass border-r border-white/10 flex flex-col h-full relative';
      el.style.width = (state.sidebarWidth || 340) + 'px';
      el.style.minWidth = (state.sidebarWidth || 340) + 'px';
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
    return nodes.map(n => {
      if (n.kind === 'directory') {
        const isClosed = c.collapsed.has(n.path);
        const fp = folderProgress(n, c);
        const fDone = isFolderDone(n, c);
        const watched = fmtDuration(fp.durationDone);
        const total = fmtDuration(fp.durationTotal);
        return `
          <div class="sidebar-dir" data-path="${n.path.replace(/"/g, '&quot;')}">
            <div onclick="window.toggleFolder('${n.path.replace(/'/g,"\\'")}')" class="flex items-center gap-2 px-3 py-2 text-slate-300 hover:bg-white/5 cursor-pointer select-none transition-colors rounded-lg mx-1" style="padding-left:${12 + level*14}px" title="${escapeHtml(n.name)}">
              <span class="folder-caret ${isClosed?'closed':'open'} text-slate-500 shrink-0">${Ico.caret}</span>
              ${Ico.folder}
              <span class="text-sm font-medium truncate flex-1">${escapeHtml(n.name)}</span>
              <span class="shrink-0">${circularProgressSVG(fp.weightedPct, 16, 2.5)}</span>
              <span class="sidebar-folder-progress text-[10px] text-slate-500 font-mono shrink-0 ml-1">${watched} / ${total}</span>
              <button onclick="event.stopPropagation(); window.toggleFolderDone('${n.path.replace(/'/g,"\\'")}')" class="shrink-0 p-1 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400 transition-colors ml-1" title="Toggle folder complete">
                ${fDone ? `<span class="text-emerald-400">${Ico.check}</span>` : Ico.circle}
              </button>
            </div>
            <div class="tree-line ml-4 ${isClosed?'hidden':''}">${build(n.children, level+1)}</div>
          </div>`;
      } else {
        if (['srt','vtt'].includes(n.type)) return '';
        const active = state.currentFile?.path === n.path ? 'active' : '';
        const done = isDone(c, n.path);
        return `
          <div class="flex items-center group sidebar-file" data-path="${n.path.replace(/"/g, '&quot;')}">
            <div onclick="window.loadFileByPath('${n.path.replace(/'/g,"\\'")}')" class="file-item flex-1 flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none ${active}" style="padding-left:${12 + level*14}px" title="${escapeHtml(n.name)}">
              ${sidebarItemIcon(n)}
              <span class="text-sm truncate flex-1">${escapeHtml(n.name)}</span>
              ${fileDurationDisplay(c, n.path)}
              <span class="sidebar-file-check shrink-0">${done ? Ico.check : ''}</span>
            </div>
            <button onclick="event.stopPropagation(); window.toggleDoneSidebar('${n.path.replace(/'/g,"\\'")}')" class="shrink-0 p-1.5 mr-1 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Toggle complete">
              ${done ? `<span class="text-emerald-400">${Ico.check}</span>` : Ico.circle}
            </button>
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
      <div id="sidebar-content" class="flex-1 overflow-auto py-2 text-[13px] md:text-sm">
        ${build(c.tree)}
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

  const overlay = document.getElementById('mobile-overlay');
  if (overlay) {
    if (isMob && state.mobileSidebarOpen) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
  }
}

// --- Surgical sidebar updates (no full re-render) ---
function updateSidebarFile(path) {
  const item = document.querySelector(`.sidebar-file[data-path="${CSS.escape(path)}"]`);
  if (!item) return;
  const course = state.currentCourse;
  const done = isDone(course, path);
  const checkEl = item.querySelector('.sidebar-file-check');
  if (checkEl) checkEl.innerHTML = done ? Ico.check : '';
  const btn = item.querySelector('button[title="Toggle complete"]');
  if (btn) btn.innerHTML = done ? `<span class="text-emerald-400">${Ico.check}</span>` : Ico.circle;
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
        const prog = dirEl.querySelector('svg');
        if (prog) {
          const newSvg = circularProgressSVG(fp.weightedPct, 16, 2.5);
          prog.outerHTML = newSvg;
        }
        const btn = dirEl.querySelector('button[title="Toggle folder complete"]');
        if (btn) btn.innerHTML = fDone ? `<span class="text-emerald-400">${Ico.check}</span>` : Ico.circle;
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
  c.progress.files[path].completed = val;
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
    c.progress.files[f.path].completed = targetVal;
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
  state.currentCourse = null;
  state.currentFile = null;
  state.sidebarOpen = true;
  state.mobileSidebarOpen = false;
  render();
}
