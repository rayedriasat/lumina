import * as fs from 'fs';
import * as path from 'path';

const srcDir = './js';
const files = ['app.js', 'player.js', 'state.js', 'render.js', 'fs.js', 'db.js', 'icons.js', 'media-index.js', 'native-fs.js', 'pdf-viewer.js'];

for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(srcDir, f.replace(/\.js$/, '.test.mjs')));
}
for (const f of files) {
  const dest = path.join(srcDir, f.replace(/\.js$/, '.test.mjs'));
  let content = fs.readFileSync(dest, 'utf8');
  content = content.replace(/from\s+(['"])(\.\.?\/[^'"]+)\.js(['"])/g, "from $1$2.test.mjs$3");
  fs.writeFileSync(dest, content);
}

function stub(name, value) {
  try { globalThis[name] = value; } catch {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}
stub('window', { innerWidth: 1024, addEventListener: () => {} });
stub('document', { addEventListener: () => {}, activeElement: null, querySelectorAll: () => [] });
stub('localStorage', { getItem: () => null, setItem: () => {} });
stub('indexedDB', { open: () => ({ onerror: null, onsuccess: null, onupgradeneeded: null }) });
stub('Image', class { constructor() {} });
stub('requestAnimationFrame', (fn) => setTimeout(fn, 16));
stub('requestIdleCallback', (fn) => setTimeout(fn, 0));
stub('MutationObserver', class { observe() {} disconnect() {} });

try {
  const modules = [];
  for (const f of files) {
    try {
      const m = await import('./js/' + f.replace(/\.js$/, '.test.mjs'));
      modules.push([f, Object.keys(m), null]);
    } catch (e) {
      modules.push([f, null, e.message.split('\n')[0]]);
    }
  }
  for (const [name, keys, err] of modules) {
    if (err) {
      console.log('X ' + name + ' FAILED: ' + err);
    } else {
      console.log('OK ' + name + ' (' + keys.length + ' exports)');
    }
  }
} finally {
  for (const f of files) {
    try { fs.unlinkSync(path.join(srcDir, f.replace(/\.js$/, '.test.mjs'))); } catch {}
  }
}
