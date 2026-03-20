import { getItem, setItem } from "./storage";

export type SyncEvent = {
  deviceId: string;
  topicId: string;
  questionId: string;
  correct: boolean;
  difficulty: number;
  quality: number;
  createdAt: string;
};

const QUEUE_KEY = "sync-queue";
const DEVICE_KEY = "device-id";

export async function getDeviceId(): Promise<string> {
  const existing = await getItem<string | null>(DEVICE_KEY, null);
  if (existing) return existing;
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `device-${Math.random().toString(36).slice(2)}`;
  await setItem(DEVICE_KEY, id);
  return id;
}

export async function enqueueEvent(event: SyncEvent): Promise<void> {
  const queue = await getItem<SyncEvent[]>(QUEUE_KEY, []);
  queue.push(event);
  await setItem(QUEUE_KEY, queue);
}

export async function flushQueue(apiBase: string): Promise<number> {
  const queue = await getItem<SyncEvent[]>(QUEUE_KEY, []);
  if (!queue.length) return 0;

  const res = await fetch(`${apiBase}/sync/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: queue })
  });

  if (!res.ok) return 0;
  await setItem(QUEUE_KEY, []);
  return queue.length;
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}
