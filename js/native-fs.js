// native-fs.js
// This file serves as the Native File System bridge for Tauri.
// It polyfills the `FileSystemDirectoryHandle` interface used by Lumina.

export async function pickTauriFolder() {
  const { open } = window.__TAURI__.dialog;
  const { readDir, readTextFile } = window.__TAURI__.fs;
  const { convertFileSrc } = window.__TAURI__.tauri;

  const selectedPath = await open({ directory: true, multiple: false });
  if (!selectedPath) return null;

  const folderName = selectedPath.split(/[\/\\]/).pop();

  return createTauriHandle(selectedPath, folderName, readDir, readTextFile, convertFileSrc);
}

export async function restoreNativeHandle(data) {
  if (!data) return null;
  if (window.__TAURI__) {
    const { readDir, readTextFile } = window.__TAURI__.fs;
    const { convertFileSrc } = window.__TAURI__.tauri;
    return createTauriHandle(data.path, data.name, readDir, readTextFile, convertFileSrc, data.kind === 'directory');
  }
  return null;
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
    async getDirectoryHandle(dirName, options) {
      const childPath = path + '/' + dirName;
      return createTauriHandle(childPath, dirName, readDir, readTextFile, convertFileSrc, true);
    },
    async getFile() {
      const nativeUrl = convertFileSrc(path);
      return {
        name,
        path,
        nativeUrl,
        async text() {
          return await readTextFile(path);
        },
        async arrayBuffer() {
          // Typically text() is enough for JSON/subtitles. For binary, use readBinaryFile if needed.
          const { readBinaryFile } = window.__TAURI__.fs;
          const bytes = await readBinaryFile(path);
          return bytes.buffer;
        }
      };
    }
  };
}
