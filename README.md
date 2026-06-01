# Lumina — Offline Course Player v2

<p align="center">
  <video src="./lumina_walkthrough.mp4" autoplay muted loop playsinline controls poster="./assets/splash.png" style="max-width: 100%; border-radius: 16px;">
    Your browser does not support embedded video.
    <a href="./lumina_walkthrough.mp4">Watch the feature demo</a>.
  </video>
</p>

<p align="center">
  <strong>Give a star to the github repo if you loved the project.</strong>
</p>

A self-hosted, zero-backend, glassmorphism PWA that turns your offline course folders into a beautiful, sequential learning experience with gamification elements.

The web build is desktop-only. Use a Chromium-based desktop browser such as Chrome, Edge, Brave, or Opera, or use the Tauri desktop app. Mobile browsers, Safari, and Firefox are not supported for the web version because the app depends on the File System Access API.

**New in v2:** Subtitle search panel, thumbnail seek peek, markdown notes, bookmarks, immersive auto-proceed, auto-play, PDF.js viewer, fixed HTML viewer, collapsible sidebar, import/export sync, responsive design, and gamification.

---

## 🚀 Quick Start

> **Main Interaction Page**: The primary way to use Lumina is through the **web version** on a desktop Chromium browser. Mobile browsers and nonstandard browsers will show a warning and should use the Tauri desktop app instead.

1. Go to the GitHub Pages link (e.g. `https://username.github.io/lumina/`).
2. Click the **install icon** in the address bar → **Install as app**.
3. Now you have a fully functional offline desktop app.

Alternatively, you can run it locally using Node.js or run the Tauri Desktop build.

### Run Locally (Dev)
```bash
node server.js
```
Open **http://localhost:3321** in **Chrome** or **Edge** on desktop.

### Build Static Web Bundle
```bash
npm run build
```
This creates a deployable `dist/` folder for static hosting.

### Course Folder Requirements
Lumina reads the folder you choose directly from your machine. A course can contain nested folders and mixed lesson files:

- Videos: `.mp4`, `.webm`, browser-supported media files
- Subtitles: `.srt` or `.vtt` next to the matching video file
- Documents: `.pdf`
- Web lessons: `.html`
- Images: common browser-supported image formats

Progress is written back to `course-progress.json` in the selected course folder, so the app needs read/write permission for that folder.

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
- **Keyboard shortcuts:** previous/next, completion, bookmarks, seeking, and playback-speed control.

### Video Player & Subtitles
- **Auto-play** & **Auto-proceed** to the next lesson automatically.
- **Speeds:** 0.5x → 3.5x, with 0.1x keyboard stepping.
- **Visual feedback:** YouTube-style seek flashes for `Z` / `X` and a translucent speed box for speed shortcuts.
- **Immersive Up Next:** Netflix-style full-player countdown with cancel/play-now controls before the next lesson starts.
- **Thumbnail seek peek:** video hover timeline previews.
- **Subtitle search panel:** searchable side-panel of captions, click any cue to jump.

### Notes, Bookmarks & Viewers
- Markdown notes below every lesson & video bookmarks with exact timestamps.
- Built-in PDF canvas viewer and isolated HTML sandboxed iframe.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `←` | Previous lesson |
| `→` | Next lesson |
| `Z` | Seek backward 10 seconds with visual feedback |
| `X` | Seek forward 10 seconds with visual feedback |
| `S` | Decrease playback speed by 0.1x |
| `D` | Increase playback speed by 0.1x |
| `G` | Set speed to 1.8x |
| `H` | Set speed to 2.5x |
| `Y` | Set speed to 3.0x |
| `B` | Add a video bookmark |
| `.` | Toggle current lesson complete |
| `Enter` | Start the Up Next lesson while countdown is visible |

Speed shortcuts update the video playback rate immediately and show the current speed in a small translucent overlay.

---

## 💾 Progress & Sync

Lumina stores folder permissions in IndexedDB so your courses remain available after reloads. Per-course progress, notes, bookmarks, completion state, and lesson durations are stored in `course-progress.json` inside each selected course folder. Use **Export All** and **Import** to move gamification data and merged progress between browsers or devices.

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
2. The GitHub Pages web build is not supported on mobile browsers.
3. Codecs: MKV playback depends on the browser. MP4/H.264 is safest.

Built for learners who own their files. 🎓


# File Tree: lumina

**Generated:** 6/1/2026, 11:09:58 AM
**Root Path:** `d:\OfflineCoursePlayers\lumina`

```
├── 📁 assets
│   ├── 🖼️ icon.png
│   └── 🖼️ splash.png
├── 📁 css
│   └── 🎨 style.css
├── 📁 js
│   ├── 📄 app.js
│   ├── 📄 db.js
│   ├── 📄 fs.js
│   ├── 📄 icons.js
│   ├── 📄 native-fs.js
│   ├── 📄 pdf-viewer.js
│   ├── 📄 player.js
│   ├── 📄 render.js
│   └── 📄 state.js
├── 📁 vendor
│   ├── 🎨 pdf_viewer.css
│   ├── 📄 pdfjs.min.mjs
│   ├── 📄 pdfjs.worker.min.mjs
│   ├── 🎨 plyr.css
│   ├── 📄 plyr.js
│   └── 📄 tailwindcss.js
├── ⚙️ .gitignore
├── 📝 APP_EXPORT_INSTRUCTIONS.md
├── 📝 README.md
├── 📄 build-web.js
├── 🌐 index.html
├── 📦 lumina.zip
├── ⚙️ manifest.json
├── ⚙️ package.json
├── 📄 server.js
└── 📄 sw.js
```

---
*Generated by FileTree Pro Extension*
