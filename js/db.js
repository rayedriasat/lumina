const DB_NAME = 'LuminaDB';
const DB_VERSION = 1;

export function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => rej(req.error);
    req.onsuccess = () => res(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('courses')) db.createObjectStore('courses', { keyPath: 'id' });
    };
  });
}
export async function putCourse(c) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('courses', 'readwrite');
    const st = tx.objectStore('courses');
    const r = st.put(c);
    r.onsuccess = () => res(c);
    r.onerror = () => rej(r.error);
  });
}
export async function getCourses() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('courses', 'readonly');
    const st = tx.objectStore('courses');
    const r = st.getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function delCourse(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('courses', 'readwrite');
    const st = tx.objectStore('courses');
    const r = st.delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
