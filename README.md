# Lumina — Offline Course Player

<p align="center">
  <a href="https://rayedriasat.github.io/lumina/">
    <img src="./assets/lumina_walkthrough.gif" alt="Lumina feature demo walkthrough">
  </a>
</p>

<p align="center">
  <a href="https://rayedriasat.github.io/lumina/"><strong>▶ Live demo — rayedriasat.github.io/lumina</strong></a>
</p>

<p align="center">
  <em>A self-hosted, zero-backend, glassmorphism PWA that turns your offline course folders into a beautiful, sequential learning experience — with notes, bookmarks, subtitles, and gamification.</em>
</p>

<p align="center">
  ⭐ <strong>If Lumina helps you learn, please star the repo.</strong>
</p>

---

## Table of Contents

- [What is Lumina?](#what-is-lumina)
- [Quick Start](#-quick-start)
- [Course Folder Requirements](#-course-folder-requirements)
- [Features](#-features)
- [Keyboard Shortcuts](#️-keyboard-shortcuts)
- [Architecture](#️-architecture)
- [Project Structure](#️-project-structure)
- [Progress & Sync](#-progress--sync)
- [Building & Releasing](#-building--releasing)
- [Browser Support & Limitations](#️-browser-support--limitations)
- [Privacy](#-privacy)

---

## What is Lumina?

Lumina plays course folders **directly from your disk** — no upload, no server, no account. It reads the folder you pick using the browser's File System Access API, presents your lessons as an ordered, trackable curriculum, and writes progress back into the folder itself as `course-progress.json`. Your files never leave your machine.

> **Best experienced on a Chromium-based desktop browser** (Chrome, Edge, Brave, Opera) or the Tauri desktop app. Safari, Firefox, and mobile browsers lack the File System Access API the web version depends on, and will show a guidance warning.

---

## 🚀 Quick Start

### Option 1 — Install the PWA (recommended)

1. Open **[rayedriasat.github.io/lumina](https://rayedriasat.github.io/lumina/)** in Chrome or Edge on desktop.
2. Click the **install icon** in the address bar → **Install as app**.
3. You now have a fully offline desktop app. Click **Add Course**, pick a folder, and start learning.

### Option 2 — Run locally

```bash
node server.js
```

Then open **http://localhost:3321** in Chrome or Edge.

### Option 3 — Native desktop app (Tauri)

See [Building & Releasing](#-building--releasing) to produce a Windows `.exe` / `.msi`. This is the way to use Lumina on Firefox/Safari machines.

---

## 📂 Course Folder Requirements

Point Lumina at any folder. It scans nested subfolders and orders lessons naturally (so `Lesson 2` sorts before `Lesson 10`). Supported lesson types:

| Type | Extensions | Notes |
|---|---|---|
| **Video** | `.mp4`, `.webm`, `.ogg`, `.ogv`, `.mov`, `.mkv` | `.mp4` (H.264) is the most reliable; MKV depends on the browser. |
| **Subtitles** | `.srt`, `.vtt` | Place next to the matching video with the same base name (`lesson.mp4` → `lesson.srt`). SRT is auto-converted to WebVTT. |
| **Documents** | `.pdf` | Rendered via a built-in PDF.js canvas viewer. |
| **Web lessons** | `.html`, `.htm` | Opened in a sandboxed iframe. |
| **Images** | `.jpg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg` | |

Progress is saved to `course-progress.json` inside the chosen folder, so Lumina needs **read/write** permission for it. A small `.lumina-cache/` folder holds generated seek-preview thumbnails.

---

## 🎓 Features

### Dashboard & Gamification
- Personalized hero header with editable username.
- Stat cards: total courses, completed lessons, notes, and bookmarks.
- Activity heatmap, most-productive hours, and current/highest streaks.
- Recent bookmarks & notes for fast revision.
- One-click **Export / Import** of your full profile and progress.

### Course Player
- Collapsible file-tree sidebar with file-type icons and per-file completion toggles.
- Subtitle files are hidden from the tree but auto-loaded for their video.
- Duration-weighted progress — a 40-min lecture counts more than a 2-min intro.
- Full keyboard control (see below).

### Video & Subtitles
- **Auto-play** and **auto-proceed** with a Netflix-style "Up Next" countdown (cancel / play-now).
- Playback speed **0.5×–3.5×** with 0.1× keyboard stepping and one-tap presets.
- YouTube-style seek flashes for `Z` / `X` and a translucent speed overlay.
- **Thumbnail seek peek** — hover the timeline to preview frames (cached as a sprite).
- **Searchable caption panel** — filter cues and click any line to jump.
- **Resume banner** — pick up where you left off, or press `Enter` to start over.

### Notes, Bookmarks & Viewers
- Live-preview Markdown notes attached to every lesson.
- File-level saves (`B`) and precise timestamp bookmarks (`Shift`+`B`).
- Built-in PDF viewer and isolated HTML sandbox.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `←` / `→` | Previous / next lesson |
| `Z` / `X` | Seek backward / forward 10s (with visual feedback) |
| `S` / `D` | Decrease / increase playback speed by 0.1× |
| `R` | Toggle 1.0× |
| `G` | Toggle 1.8× |
| `H` | Toggle 2.5× |
| `Y` | Toggle 3.0× |
| `C` | Toggle captions |
| `B` | Save / unsave current file |
| `Shift`+`B` | Add a timestamp bookmark |
| `.` | Toggle current lesson complete |
| `Enter` | Start "Up Next" now (or restart from 0 while the resume banner shows) |

Preset speed keys (`R`/`G`/`H`/`Y`) toggle back to your previous speed when pressed again.

---

## 🏗️ Architecture

Lumina is **vanilla JavaScript (ES modules)** with no framework and no bundler at runtime.

| Layer | Technology |
|---|---|
| **UI** | Vanilla JS + Tailwind CSS |
| **Video** | [Plyr](https://plyr.io) — speeds, captions, PiP, fullscreen |
| **Subtitles** | Auto-detect `.srt`/`.vtt`, SRT→WebVTT conversion, searchable cues |
| **Seek previews** | Background-generated single-sprite thumbnails (memory-friendly) |
| **PDF** | Mozilla PDF.js canvas viewer |
| **HTML lessons** | Sandboxed iframe |
| **Storage** | IndexedDB (folder handles) + per-course `course-progress.json` |
| **Offline** | Service Worker caches the full app shell |

---

## 🗂️ Project Structure

```
lumina/
├── index.html            # App shell (loads ES modules)
├── manifest.json         # PWA manifest (standalone)
├── sw.js                 # Service Worker — offline app-shell cache
├── server.js             # Dev localhost server (port 3321)
├── build-web.js          # Copies a deployable bundle into dist/
├── css/
│   └── style.css         # Glassmorphism design system & animations
├── js/
│   ├── app.js            # Entry point: boot, courses, SW, shortcuts
│   ├── state.js          # Global state + gamification
│   ├── db.js             # IndexedDB (folder handle persistence)
│   ├── fs.js             # Folder scan, SRT/VTT parsing, progress math
│   ├── render.js         # Dashboard, sidebar, top bar, heatmap
│   ├── player.js         # Plyr integration, subtitles, bookmarks, auto-proceed
│   ├── media-index.js    # Background duration indexing + thumbnail sprites
│   ├── pdf-viewer.js     # PDF.js rendering
│   ├── native-fs.js      # Tauri filesystem bridge
│   └── icons.js          # Inline SVG icon set
├── vendor/               # Plyr, PDF.js, Tailwind
└── src-tauri/            # Native desktop wrapper
```

---

## 💾 Progress & Sync

- **Folder handles** are stored in IndexedDB, so your courses reappear after a reload (you may be asked to re-grant permission).
- **Per-course state** — completion, playback position, notes, bookmarks, and indexed durations — lives in `course-progress.json` inside each course folder. It travels with your files.
- **Export All / Import** moves your gamification profile and merges progress across browsers or machines via a single JSON backup.

---

## 📦 Building & Releasing

### Static web bundle

```bash
npm run build
```

Produces a `dist/` folder ready for any static host (GitHub Pages, Vercel, Netlify).

### Desktop app (Tauri)

```bash
cd src-tauri
cargo install tauri-cli   # first time only
npm install
cargo tauri build
```

Installers land in `src-tauri/target/release/bundle/`.

---

## ⚠️ Browser Support & Limitations

| Browser | Web / PWA | Notes |
|---|---|---|
| Chrome / Edge / Brave / Opera (desktop) | ✅ Full | Requires the File System Access API. |
| Firefox / Safari (desktop) | ❌ | No File System Access API — use the **Tauri** app. |
| Mobile browsers | ❌ | Folder picker unavailable; shows a guidance warning. |

- **Codecs:** MP4/H.264 is safest. MKV and exotic codecs depend on the browser.
- Lumina is intentionally **desktop-first** for the web build.

---

## 🔒 Privacy

Lumina is **zero-backend**. Your videos, notes, and progress stay on your device — nothing is uploaded. The hosted demo loads only Google Analytics to count page visits; it never sees your files or course data.

---

<p align="center"><em>Built for learners who own their files. 🎓</em></p>
