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
        const isChildDir = !!entry.children; // Very basic check
        yield [entry.name, createTauriHandle(entry.path, entry.name, readDir, readTextFile, convertFileSrc, isChildDir)];
      }
    },
    async getFileHandle(fileName, options) {
      // In a full implementation, check if it exists or create
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
 */
export async function pickCapacitorFolder() {
  // Requires "@capawesome/capacitor-file-picker" and "@capacitor/filesystem"
  // Example dummy implementation to show the structure:
  alert("Capacitor Folder picking requires @capawesome/capacitor-file-picker to be implemented.");
  return null;
}
