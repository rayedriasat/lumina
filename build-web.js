const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const destDir = path.join(__dirname, 'dist');
const ignoreDirs = ['node_modules', 'src-tauri', '.git', 'dist', 'android', 'capacitor-cordova-android-plugins', '.vscode'];
const ignoreFiles = ['tailwind.config.js', 'tailwind.input.css'];

function copySync(src, dest) {
  const base = path.basename(src);
  if (ignoreDirs.includes(base)) return;
  if (ignoreFiles.includes(base)) return;

  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(file => copySync(path.join(src, file), path.join(dest, file)));
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying web assets to dist/ for Tauri build...');
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
copySync(srcDir, destDir);
console.log('Done.');