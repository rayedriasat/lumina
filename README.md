# Lumina — Offline Course Player v2

A self-hosted, zero-backend, glassmorphism PWA that turns your offline course folders into a beautiful, sequential learning experience with gamification elements.

**New in v2:** Subtitle search panel, thumbnail seek peek, markdown notes, bookmarks, auto-proceed, auto-play, PDF.js viewer, fixed HTML viewer, collapsible sidebar, import/export sync, responsive design, and gamification!

---

## 🚀 Quick Start

> **Main Interaction Page**: The primary way to use Lumina is through the **web version** via GitHub Pages. On supported browsers (Chrome, Edge), you can install the PWA for full offline support.

1. Go to the GitHub Pages link (e.g. `https://username.github.io/lumina/`).
2. Click the **install icon** in the address bar → **Install as app**.
3. Now you have a fully functional offline desktop app!

Alternatively, you can run it locally using Node.js or run the Tauri Desktop build.

### Run Locally (Dev)
```bash
node server.js
```
Open **http://localhost:3321** in **Chrome** or **Edge**.

---

## 🏗️ Architecture

| Layer | Technology |
|---|---|
| **UI** | Vanilla JS (ES modules) + Tailwind CSS |
| **Video** | Plyr.io (speeds up to 3.5x, captions, PiP, fullscreen) |
| **Subtitles** | Auto-detects `.srt`/`.vtt`, converts SRT→WebVTT, searchable cue panel |
| **PDF** | Mozilla PDF.js custom canvas viewer |
| **HTML** | Sandboxed iframe with isolated white background |
| **Progress** | `course-progress.json` inside each course folder |
| **Storage** | IndexedDB (folder handles) + per-course JSON |
| **Offline** | Service Worker caches the full app shell |

---

## 🎓 Features

### Dashboard & Gamification
- Beautiful Hero header with your personalized username.
- **Stats:** total courses, completed lessons, notes count, bookmark count.
- **Activity Gamification:** Activity heatmap, productive hours, current & highest streaks.
- **Recent Bookmarks & Notes** for quick revision.
- **Export / Import** gamification profile and bookmarks via JSON backup.

### Course Player
- **Collapsible file tree sidebar** with file-type icons and per-file completion toggles.
- Subtitle files (`.srt`, `.vtt`) are **hidden** from the tree but still loaded automatically for videos.
- **Keyboard shortcuts:** `←` / `→` (Previous / Next), `C` (Toggle complete), `B` (Bookmark).

### Video Player & Subtitles
- **Auto-play** & **Auto-proceed** to the next lesson automatically.
- **Speeds:** 0.5x → 3.5x in 0.25x steps.
- **Thumbnail seek peek:** video hover timeline previews.
- **Subtitle search panel:** searchable side-panel of captions, click any cue to jump.

### Notes, Bookmarks & Viewers
- Markdown notes below every lesson & video bookmarks with exact timestamps.
- Built-in PDF canvas viewer and isolated HTML sandboxed iframe.

---

## 📦 Shipping & Releases

Lumina v2 is focused strictly on the Web/PWA and Tauri Desktop builds.

### 1. Web / GitHub Pages (Primary)
The root directory is ready to be hosted as a static site (GitHub Pages, Vercel, Netlify). 

### 2. Desktop (Tauri)
To build the native desktop app (e.g., Windows `.exe`, `.msi`) locally:
```bash
cd src-tauri
cargo install tauri-cli
npm i
cargo tauri build
```
The compiled installers will be in `src-tauri/target/release/bundle/`.

---

## 🗂️ Project Structure

```
lumina/
├── index.html              # App shell (ES modules)
├── manifest.json           # PWA standalone execution
├── sw.js                   # Offline PWA cache
├── server.js               # Dev localhost server
├── src-tauri/              # Native App wrapper
├── css/
│   └── style.css           # Glassmorphism, animations, overrides
├── js/
│   ├── app.js              # Entry point, init, PWA setup
│   ├── state.js            # Global reactive state & Gamification
│   ├── icons.js            # SVG icon library
│   ├── db.js               # IndexedDB storage
│   ├── fs.js               # File scanning, VTT/SRT parsers
│   ├── render.js           # Dashboard, UI & Heatmap creation
│   ├── player.js           # Plyr integration & subtitles
│   ├── native-fs.js        # Tauri bridging
│   └── pdf-viewer.js       # PDF render logic
└── vendor/                 # Dependencies (Tailwind, Plyr, PDF.js)
```

---

## ⚠️ Known Limitations
1. **File System Access API** is Chromium-only (Chrome, Edge, Brave, Opera). Firefox & Safari desktop will need the **Tauri** wrapper.
2. Codecs: MKV playback depends on the browser. MP4/H.264 is safest.

Built for learners who own their files. 🎓