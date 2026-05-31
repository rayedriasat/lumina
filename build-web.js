const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const destDir = path.join(__dirname, 'dist');
const ignoreDirs = ['node_modules', 'src-tauri', '.git', 'dist', 'android', 'capacitor-cordova-android-plugins', '.vscode'];

function copySync(src, dest) {
  if (ignoreDirs.includes(path.basename(src))) return;
  
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