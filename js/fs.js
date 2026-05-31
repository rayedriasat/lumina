export function getFileType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['mp4','webm','ogg','ogv','mov','mkv'].includes(ext)) return 'video';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['html','htm'].includes(ext)) return 'html';
  if (['srt'].includes(ext)) return 'srt';
  if (['vtt'].includes(ext)) return 'vtt';
  if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) return 'image';
  return 'other';
}

export async function scanDirectory(dirHandle, path = '') {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const p = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      entries.push({ name, path: p, kind: 'directory', handle, children: await scanDirectory(handle, p) });
    } else {
      entries.push({ name, path: p, kind: 'file', handle, type: getFileType(name) });
    }
  }
  entries.sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (b.kind === 'directory' && a.kind !== 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return entries;
}

export function flattenFiles(tree, arr = []) {
  for (const n of tree) {
    if (n.kind === 'file' && ['video','pdf','html','image'].includes(n.type)) arr.push(n);
    if (n.children) flattenFiles(n.children, arr);
  }
  return arr;
}

export function flattenAll(tree, arr = []) {
  for (const n of tree) {
    arr.push(n);
    if (n.children) flattenAll(n.children, arr);
  }
  return arr;
}

export async function resolveDirHandle(rootHandle, relPath) {
  if (!relPath) return rootHandle;
  let cur = rootHandle;
  for (const part of relPath.split('/')) {
    if (!part) continue;
    cur = await cur.getDirectoryHandle(part);
  }
  return cur;
}

export function srtToVtt(srt) {
  let vtt = 'WEBVTT\n\n';
  const lines = srt.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    if (/^\d+$/.test(lines[i].trim())) i++;
    if (i >= lines.length) break;
    const tl = lines[i];
    if (tl && tl.includes('-->')) {
      vtt += tl.replace(/,/g, '.') + '\n';
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^\d+$/.test(lines[i].trim()) && !lines[i].includes('-->')) {
        vtt += lines[i] + '\n';
        i++;
      }
      vtt += '\n';
    } else { i++; }
  }
  return vtt;
}

export function parseVTT(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').split('\n\n');
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    cues.push({ start: parseTime(startStr), end: parseTime(endStr), text: textLines.join('\n').trim() });
  }
  return cues;
}

function parseTime(t) {
  const parts = t.split(':');
  if (parts.length === 3) {
    return (+parts[0]) * 3600 + (+parts[1]) * 60 + parseFloat(parts[2]);
  }
  return (+parts[0]) * 60 + parseFloat(parts[1]);
}

export function fmtTime(s) {
  if (!s && s !== 0) return '--:--';
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  if (h > 0) return `${h}:${(m % 60).toString().padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

export function fmtDuration(s) {
  if (!s || s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function mdToHtml(md) {
  if (!md) return '';
  let html = escapeHtml(md)
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
    .replace(/\*(.*?)\*/gim, '<i>$1</i>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/```[\s\S]*?```/gim, (m) => `<pre><code>${m.slice(3, -3)}</code></pre>`)
    .replace(/^- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/gim, (m) => `<ul>${m}</ul>`);
  return html.replace(/\n/gim, '<br>');
}

export function escapeHtml(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Duration-weighted analytics ---

const NON_VIDEO_WEIGHT = 10; // seconds

export function fileWeight(course, path, type) {
  if (type === 'video') {
    const dur = course.progress?.files?.[path]?.duration;
    return dur || 0;
  }
  return NON_VIDEO_WEIGHT;
}

export function fileWatchedWeight(course, path, type) {
  const pf = course.progress?.files?.[path];
  if (!pf) return 0;
  if (pf.completed) return fileWeight(course, path, type);
  if (type === 'video' && pf.position) {
    return Math.min(pf.position, fileWeight(course, path, type));
  }
  return 0;
}

export function getDescendantFiles(node, arr = []) {
  if (node.kind === 'file' && ['video','pdf','html','image'].includes(node.type)) {
    arr.push(node);
  }
  if (node.children) {
    for (const c of node.children) getDescendantFiles(c, arr);
  }
  return arr;
}

export function folderProgress(node, course) {
  const files = getDescendantFiles(node);
  if (!files.length) return { pct: 0, done: 0, total: 0, durationDone: 0, durationTotal: 0, weightedPct: 0, totalWeight: 0, watchedWeight: 0 };
  let done = 0, durationDone = 0, durationTotal = 0, totalWeight = 0, watchedWeight = 0;
  for (const f of files) {
    const dur = course.progress?.files?.[f.path]?.duration || 0;
    const pos = course.progress?.files?.[f.path]?.position || 0;
    const isComp = !!course.progress?.files?.[f.path]?.completed;
    const weight = fileWeight(course, f.path, f.type);
    const wWatched = isComp ? weight : (f.type === 'video' ? Math.min(pos, weight) : 0);
    
    totalWeight += weight;
    watchedWeight += wWatched;
    
    if (f.type === 'video' && dur) {
      durationTotal += dur;
      if (isComp) durationDone += dur;
      else if (pos) durationDone += Math.min(pos, dur);
    }
    if (isComp) done++;
  }
  const pct = Math.round((done / files.length) * 100);
  const weightedPct = totalWeight > 0 ? Math.round((watchedWeight / totalWeight) * 100) : 0;
  return { pct, done, total: files.length, durationDone, durationTotal, weightedPct, totalWeight, watchedWeight };
}

export function overallCourseProgress(course) {
  if (!course.tree || !course.tree.length) {
    return { pct: 0, done: 0, total: 0, durationDone: 0, durationTotal: 0, weightedPct: 0, totalWeight: 0, watchedWeight: 0 };
  }
  return folderProgress({ children: course.tree }, course);
}

export function isFolderDone(node, course) {
  const { done, total } = folderProgress(node, course);
  return total > 0 && done === total;
}

export function circularProgressSVG(pct, size = 18, stroke = 3) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = pct >= 100 ? '#34d399' : pct > 50 ? '#818cf8' : pct > 20 ? '#c084fc' : '#64748b';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="shrink-0">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" 
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size/2} ${size/2})" style="transition: stroke-dashoffset 0.6s ease"/>
  </svg>`;
}
