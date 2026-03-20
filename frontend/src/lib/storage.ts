const DB_NAME = "aurora-coach";
const STORE = "keyval";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fallbackGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function fallbackSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function getItem<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await withStore<T>("readonly", (store) => store.get(key));
    return (value ?? fallback) as T;
  } catch {
    return fallbackGet<T>(key, fallback);
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(value, key));
  } catch {
    fallbackSet(key, value);
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(key));
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
