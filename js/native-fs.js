// native-fs.js
// This file serves as the Native File System bridge for Tauri and Capacitor.
// It polyfills the `FileSystemDirectoryHandle` interface used by Lumina.

/* 
 * TAURI IMPLEMENTATION 
 */
export async function pickTauriFolder() {
  const { open } = window.__TAURI__.dialog;
  const { readDir, readTextFile } = window.__TAURI__.fs;
  const { convertFileSrc } = window.__TAURI__.tauri;

  const selectedPath = await open({ directory: true, multiple: false });
  if (!selectedPath) return null;

  const folderName = selectedPath.split(/[\/\\]/).pop();

  return createTauriHandle(selectedPath, folderName, readDir, readTextFile, convertFileSrc);
}

function createTauriHandle(path, name, readDir, readTextFile, convertFileSrc, isDir = true) {
  return {
    kind: isDir ? 'directory' : 'file',
    name,
    path,
    async *entries() {
      const entries = await readDir(path);
      for (const entry of entries) {
        const isChildDir = !!entry.children;
        yield [entry.name, createTauriHandle(entry.path, entry.name, readDir, readTextFile, convertFileSrc, isChildDir)];
      }
    },
    async getFileHandle(fileName, options) {
      const childPath = path + '/' + fileName;
      return createTauriHandle(childPath, fileName, readDir, readTextFile, convertFileSrc, false);
    },
    async getFile() {
      return {
        name,
        nativeUrl: convertFileSrc(path),
        async text() {
          return await readTextFile(path);
        }
      };
    }
  };
}

/* 
 * CAPACITOR IMPLEMENTATION 
 *
 * Uses:
 *   @capawesome/capacitor-file-picker  ^8.0.0  — for pickDirectory() (SAF folder picker)
 *   @capacitor/filesystem              ^8.0.0  — for readdir() / readFile()
 *
 * How it works on Android:
 *   1. FilePicker.pickDirectory() fires Android's Storage Access Framework (SAF)
 *      folder picker and returns a content:// URI the user has granted access to.
 *   2. Filesystem.readdir({ path: contentUri }) lists children of that URI.
 *      Each child's `uri` field is itself a content:// URI you can recurse into.
 *   3. Capacitor.convertFileSrc(uri) converts a content:// or file:// URI into
 *      an http://localhost/_capacitor_file_... URL that the WebView can load
 *      directly as a <video> or <audio> src.
 */
export async function pickCapacitorFolder() {
  // Dynamically import to avoid crashing in non-Capacitor environments
  const { FilePicker } = await import('@capawesome/capacitor-file-picker');
  const { Filesystem } = await import('@capacitor/filesystem');
  const { Capacitor } = await import('@capacitor/core');

  let pickedUri;
  try {
    const result = await FilePicker.pickDirectory();
    pickedUri = result.path; // content:// URI granted by the user via SAF
  } catch (err) {
    // User cancelled the picker
    if (err && (err.message === 'pickDirectory cancelled' || err.code === 'CANCELLED')) {
      return null;
    }
    throw err;
  }

  if (!pickedUri) return null;

  // Derive a human-readable folder name from the URI
  // SAF URIs look like: content://com.android.externalstorage.documents/tree/primary%3AMovies%2FCourse
  // The last decoded segment after the final %3A or / is the folder name.
  const folderName = decodeSafFolderName(pickedUri);

  return createCapacitorHandle(pickedUri, folderName, Filesystem, Capacitor, true);
}

/**
 * Decodes a SAF content:// URI into a human-readable folder name.
 * e.g. "content://.../tree/primary%3AMovies%2FCourse" → "Course"
 */
function decodeSafFolderName(uri) {
  try {
    const decoded = decodeURIComponent(uri);
    // After decoding, the path segment looks like "primary:Movies/Course"
    // Split on : or / and take the last non-empty part
    const parts = decoded.split(/[:/\\]/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].trim()) return parts[i].trim();
    }
  } catch (_) {}
  return 'Selected Folder';
}

/**
 * Creates a handle object that mirrors the FileSystemDirectoryHandle / FileSystemFileHandle
 * interface used throughout Lumina's app.js, but backed by Capacitor APIs.
 *
 * @param {string}  uri       - content:// or file:// URI for this entry
 * @param {string}  name      - Display name of this entry
 * @param {object}  Filesystem - @capacitor/filesystem module
 * @param {object}  Capacitor  - @capacitor/core module
 * @param {boolean} isDir     - true = directory handle, false = file handle
 */
function createCapacitorHandle(uri, name, Filesystem, Capacitor, isDir = true) {
  return {
    kind: isDir ? 'directory' : 'file',
    name,
    uri, // Expose the raw URI for debugging / advanced use

    /**
     * Async generator that yields [childName, childHandle] pairs,
     * matching the FileSystemDirectoryHandle.entries() API.
     */
    async *entries() {
      if (!isDir) return;

      let children;
      try {
        // Filesystem.readdir supports content:// URIs directly (no Directory enum needed)
        const result = await Filesystem.readdir({ path: uri });
        children = result.files; // Array of FileInfo: { name, uri, type, size, mtime, ctime }
      } catch (err) {
        console.error(`[Capacitor FS] readdir failed for "${name}" (${uri}):`, err);
        return;
      }

      for (const child of children) {
        // child.type is 'directory' or 'file'
        const childIsDir = child.type === 'directory';
        // child.uri is the content:// URI for this child — use it, not child.name
        const childUri = child.uri || (uri.replace(/\/$/, '') + '/' + child.name);
        yield [
          child.name,
          createCapacitorHandle(childUri, child.name, Filesystem, Capacitor, childIsDir)
        ];
      }
    },

    /**
     * Returns a child file handle by name (used when app.js resolves a known filename).
     */
    async getFileHandle(fileName) {
      // Build the child URI by appending the filename to the parent URI.
      // For SAF URIs the Filesystem plugin resolves child paths correctly.
      const childUri = uri.replace(/\/$/, '') + '/' + encodeURIComponent(fileName);
      return createCapacitorHandle(childUri, fileName, Filesystem, Capacitor, false);
    },

    /**
     * Returns a child directory handle by name.
     */
    async getDirectoryHandle(dirName) {
      const childUri = uri.replace(/\/$/, '') + '/' + encodeURIComponent(dirName);
      return createCapacitorHandle(childUri, dirName, Filesystem, Capacitor, true);
    },

    /**
     * Returns a file-like object for this entry.
     * `nativeUrl` is a WebView-loadable URL (for <video src="..."> etc.)
     * `text()` reads the file as a UTF-8 string (for JSON / subtitle files).
     */
    async getFile() {
      // convertFileSrc turns content:// → http://localhost/_capacitor_file_...
      // which the WebView can load directly as media
      const nativeUrl = Capacitor.convertFileSrc(uri);

      return {
        name,
        uri,
        nativeUrl,

        async text() {
          // readFile with Encoding.UTF8 returns a string
          const { Encoding } = await import('@capacitor/filesystem');
          const result = await Filesystem.readFile({
            path: uri,
            encoding: Encoding.UTF8,
          });
          return result.data;
        },

        async arrayBuffer() {
          // readFile without encoding returns base64 data
          const result = await Filesystem.readFile({ path: uri });
          // Convert base64 string → ArrayBuffer
          const binary = atob(result.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes.buffer;
        }
      };
    }
  };
}