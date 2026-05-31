# Lumina — Offline Course Player v2

A self-hosted, zero-backend, glassmorphism PWA that turns your offline course folders into a beautiful, sequential learning experience.

**New in v2:** Subtitle search panel, thumbnail seek peek, markdown notes, bookmarks, auto-proceed, auto-play, PDF.js viewer, fixed HTML viewer, collapsible sidebar, import/export sync, and responsive design.

---

## 🚀 Quick Start (One-Time Server)

> You cannot double-click `index.html`. Browsers block local folder access over `file://`. A secure context (`localhost` or `https`) is required.

1. Install [Node.js](https://nodejs.org).
2. In this folder, run:
   ```bash
   node server.js
   ```
3. Open **http://localhost:3321** in **Chrome** or **Edge**.
4. Click **Add Course Folder** and pick any course directory.
5. (Optional but recommended) Click the **install icon** in the address bar → **Install as app**.
6. **Stop the server** (`Ctrl+C`). The installed PWA continues to work offline.

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

### Dashboard
- Hero header, course cards with completion bars.
- **Stats:** total courses, completed lessons, notes count, bookmark count.
- **Recent Bookmarks & Notes** for quick revision.
- **Export / Import** a single JSON backup file to sync across devices.

### Course Player
- **Collapsible file tree sidebar** with file-type icons and per-file completion toggles.
- **Collapse All** button in sidebar header.
- Subtitle files (`.srt`, `.vtt`) are **hidden** from the tree but still loaded automatically for videos.
- **Keyboard shortcuts:**
  - `←` / `→` — Previous / Next lesson
  - `C` — Toggle complete
  - `B` — Add bookmark at current time

### Video Player
- **Auto-play** on lesson load.
- **Auto-proceed:** on video end, a 3-second overlay counts down to the next lesson (cancellable).
- **Speeds:** 0.5x → 3.5x in 0.25x steps.
- **Thumbnail seek peek:** hover or drag on the progress bar to see a tiny frame preview + time tooltip.
- **Subtitle search panel:** toggleable right-side panel lists every caption. Searchable. Click any cue to jump instantly.

### Notes & Bookmarks
- **Markdown notes** below every lesson (live preview).
- **Bookmarks:** capture an exact timestamp in a video (or just the file). Label them. All bookmarks appear on the dashboard for rapid revision.

### PDF Viewer
- Built with Mozilla PDF.js. Page navigation, zoom controls, smooth scrolling.

### HTML Viewer
- Renders in a sandboxed iframe with a **white background** so your course's original CSS is never polluted by Lumina's dark theme.

### Sync
- Each course folder contains `course-progress.json` (progress + notes + bookmarks).
- Copy the whole folder to another device → your data travels with it.
- **Dashboard Export/Import:** creates a single backup JSON of all courses for quick cloud/USB transfers.

---

## 📦 Shipping & Release

Lumina v2 is fully configured as a monorepo containing everything needed for web, desktop, and mobile platforms in a single codebase.

### Project Structure
- **`/` (Root)**: Contains the core PWA web application (HTML, CSS, JS) and offline capabilities (Service Worker, Manifest).
- **`/src-tauri`**: Contains the Rust-based Tauri configuration for building the lightweight native Desktop application (Windows/macOS/Linux).
- **`/android`**: Contains the Capacitor-based Android Studio project for building the native APK/AAB.

### 1. Web / GitHub Pages
The root directory is ready to be hosted as a static site. It can be directly deployed to GitHub Pages or any static hosting (Vercel, Netlify).

### 2. Desktop (Tauri)
To build the native desktop app (e.g., Windows `.exe`, `.msi`):
```bash
cd src-tauri
cargo install tauri-cli
cargo tauri build
```
The compiled installers (NSIS/MSI) will be located in `src-tauri/target/release/bundle/`.

### 3. Android (Capacitor)
To build the Android app:
```bash
npx cap sync android
npx cap open android
```
From Android Studio, you can generate a signed APK or App Bundle (`.aab`) via **Build > Generate Signed Bundle / APK**.

**Setup:**
```bash
npm install
npx cap add android
npx cap sync
npx cap open android
```
*(Requires Android Studio.)*

> ⚠️ The Android WebView does **not** support the File System Access API reliably. For a production APK you should add a Capacitor community plugin (e.g. `@capacitor-community/file-opener` or a custom plugin) to expose native folder picking, then bridge it into the web layer. The Capacitor wrapper provided here is a starting scaffold.

---

## 🗂️ Project Structure

```
lumina/
├── index.html              # App shell (ES modules)
├── manifest.json
├── sw.js                   # Offline cache
├── server.js               # One-time Node localhost server
├── css/
│   └── style.css           # Glassmorphism, animations, overrides
├── js/
│   ├── app.js              # Entry point, init, sync, keyboard
│   ├── state.js            # Global reactive state
│   ├── icons.js            # SVG icon library
│   ├── db.js               # IndexedDB helpers
│   ├── fs.js               # File scanning, VTT/SRT parsers, markdown
│   ├── render.js           # Dashboard & player layout
│   ├── player.js           # Plyr, peek, auto-proceed, subtitles, notes
│   └── pdf-viewer.js       # PDF.js canvas viewer
├── vendor/
│   ├── tailwindcss.js
│   ├── plyr.js / plyr.css
│   ├── pdfjs.min.mjs / pdfjs.worker.min.mjs
│   └── pdf_viewer.css
└── icon-*.png

```

---

## ⚠️ Known Limitations

1. **File System Access API** is Chromium-only (Chrome, Edge, Brave, Opera). Firefox & Safari desktop will need the **Tauri** wrapper.
2. **HTML relative links** between offline lesson files may not work because they are served via `blob:` URLs. Use the sidebar to navigate siblings.
3. **Android WebView** does not expose folder handles to JavaScript. Use a Capacitor native file plugin for full production support.
4. **Codecs:** MKV playback depends on the browser. MP4/H.264 is safest.
5. **Thumbnail peek** is generated live by seeking a hidden clone video. Very high-resolution files may produce slightly delayed frames.

---

## 🧪 Roadmap Ideas

- Chapter markers from `chapters.vtt`
- Dark / light theme toggle
- Full-text search across all course filenames
- Spaced-repetition quiz mode using bookmarks
- Tauri v2 migration + native Rust file-picker bridge
- Capacitor native directory-picker plugin integration

---

Built for learners who own their files. 🎓
