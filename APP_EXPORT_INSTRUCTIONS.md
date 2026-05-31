# Exporting Lumina as Native Apps

Lumina is built as a progressive web app with responsive design, making it a great candidate for native wrappers like **Tauri** (for Windows/macOS/Linux executables) and **Capacitor JS** (for Android/iOS apps).

## 1. Tauri v2 (Windows / macOS / Linux) .EXE

Tauri v2 uses the system's native WebView (like Edge WebView2 on Windows) for highly efficient, lightweight apps.

### Step 1: Install System Prerequisites (Windows)
1. **Visual Studio C++ Build Tools**:
   - Open the **Visual Studio Installer** on your PC. (Search for it in your Windows Start menu).
   - Next to your Visual Studio 2022 installation, click **Modify**.
   - Under the "Workloads" tab, check **Desktop development with C++**.
   - Click **Modify** at the bottom right and wait for the installation to finish.
2. **Rust**:
   - Go to [rustup.rs](https://rustup.rs/) and download `rustup-init.exe`.
   - Run it, type `1`, and press Enter to proceed with the default installation.
   - **CRITICAL:** After Rust finishes installing, you must **restart** VS Code and any open terminals so the `cargo` command is recognized.

### Step 2: Initialize Tauri v2 in your Workspace
Open a fresh terminal in your Lumina directory:

```bash
# Create a package.json if you don't have one
npm init -y

# Install the latest Tauri v2 CLI and API packages
npm install -D @tauri-apps/cli@latest
npm install @tauri-apps/api@latest

# Initialize the Tauri v2 project
npx tauri init
```

**Answers for `tauri init`:**
- App name: `lumina`
- Window title: `Lumina`
- Web assets path: `../`
- Dev server URL: `../`
- Dev command: *(leave empty, press Enter)*
- Build command: *(leave empty, press Enter)*

### Step 3: Install Required Tauri v2 Plugins
We need native filesystem and dialog access because WebView2 doesn't support the web `showDirectoryPicker` API natively.

Run these commands to add the plugins:
```bash
npm install @tauri-apps/plugin-dialog@latest @tauri-apps/plugin-fs@latest
npx tauri plugin add dialog
npx tauri plugin add fs
```
*(This will automatically update your Rust `Cargo.toml` and code!)*

### Step 4: Configure Permissions (Capabilities)
In Tauri v2, you must grant explicit permissions to read local files. 
Open the generated file `src-tauri/capabilities/default.json` and update its `permissions` array to allow folder and file access so it looks like this:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "fs:default",
    {
      "identifier": "fs:allow-read-directory",
      "allow": [{ "path": "**" }]
    },
    {
      "identifier": "fs:allow-read-file",
      "allow": [{ "path": "**" }]
    }
  ]
}
```

### Step 5: Build the .EXE
Run the final build command to compile the app using Rust:

```bash
npx tauri build
```
*Note: The first build will take several minutes as it downloads and compiles C++ and Rust packages.*

The finished standalone `.exe` and its installer will be situated in:
`src-tauri/target/release/` and `src-tauri/target/release/bundle/nsis/`

---

## 2. Capacitor (Android) .APK

Capacitor can convert this web app into an Android app simply by wrapping it in a native WebView.

### Setup & Build
1. Install Capacitor in your project:
   ```bash
   npm i @capacitor/core
   npm i -D @capacitor/cli @capacitor/android
   ```
2. Initialize Capacitor:
   ```bash
   npx cap init
   ```
   *Name it "Lumina" and use `com.lumina.courseplayer` as the App ID.*
   *Set your webDir to `.` (the root path).*

3. Add the Android platform:
   ```bash
   npx cap add android
   ```

4. **Required Fix for File System / Folder Selection:**
   Android WebView does not allow arbitrary directory reading via HTML APIs. You must install a plugin to select folders and iterate through them:
   ```bash
   npm i @capawesome/capacitor-file-picker
   npm i @capacitor/filesystem
   ```

5. Sync and build:
   ```bash
   npx cap sync android
   npx cap open android
   ```
   This will open Android Studio. Wait for gradle to sync, then go to **Build > Build Bundle(s) / APK(s) > Build APK(s)** to generate your app.

---

## Technical Considerations For Native Environments

Because `window.showDirectoryPicker()` only works in Chromium desktop browsers, you need to provide native implementations for it when running in Tauri or Capacitor. 

We've structured `app.js` to look for a `native-fs.js` module:
- If `window.__TAURI__` is defined, it will try to use the Tauri APIs to show a directory selector, list files, and stream video content correctly.
- If `window.Capacitor` is defined, it will try to use Capawesome's file picker.

For videos to load properly:
- **Tauri**: Use `convertFileSrc` to load video `src` URIs.
- **Capacitor**: Use `Capacitor.convertFileSrc` to load video URIs.

This ensures you have **efficient**, fully-platform-integrated builds without changing the core course-player logic.