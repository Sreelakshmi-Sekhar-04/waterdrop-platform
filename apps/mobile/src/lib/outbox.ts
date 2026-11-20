import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, api } from './api';

/**
 * The delivery person's offline queue (Phase 0 §3.4 step 6). Every action is saved on the phone
 * first, then sent in order. Each carries its own clientActionId, so if the answer is lost and the
 * action is sent again, the server returns the first result instead of saving it twice.
 *
 * - No signal: the action stays queued and is retried every 15 seconds and when the app opens.
 * - The server refuses it (for example the office cancelled the order): it leaves the queue and is
 *   shown to the delivery person as a problem to read, never silently dropped.
 */
export interface QueuedAction {
  id: string; // = clientActionId
  path: string;
  body: Record<string, unknown>;
  /** What it is about, for the screen: an order or the route. */
  orderId?: string;
  kind: 'start' | 'deliver' | 'not-delivered' | 'end';
  createdAt: string;
}
export interface Problem {
  action: QueuedAction;
  code: string;
}

const KEY = 'wtrdrop.outbox';
const PROBLEMS = 'wtrdrop.outboxProblems';

let queue: QueuedAction[] = [];
let problems: Problem[] = [];
let loaded = false;
let sending = false;
let online = true;
const listeners = new Set<() => void>();
let snapshot = { queue, problems, online, sending };
const emit = () => {
  snapshot = { queue, problems, online, sending };
  for (const l of listeners) l();
};
let onSent: (a: QueuedAction) => void = () => undefined;
/** Called after each action the server accepted (used to refresh the route). */
export function setOnSent(fn: (a: QueuedAction) => void) {
  onSent = fn;
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    queue = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as QueuedAction[];
    problems = JSON.parse((await AsyncStorage.getItem(PROBLEMS)) ?? '[]') as Problem[];
  } catch {
    queue = [];
    problems = [];
  }
  emit();
}
const save = () =>
  Promise.all([
    AsyncStorage.setItem(KEY, JSON.stringify(queue)),
    AsyncStorage.setItem(PROBLEMS, JSON.stringify(problems)),
  ]);

export async function enqueue(a: Omit<QueuedAction, 'createdAt'>) {
  await load();
  queue = [...queue, { ...a, createdAt: new Date().toISOString() }];
  await save();
  emit();
  void flush();
}

/** Sends queued actions one by one, oldest first. Stops at the first network failure. */
export async function flush() {
  await load();
  if (sending) return;
  sending = true;
  emit();
  try {
    while (queue.length) {
      const a = queue[0]!;
      try {
        await api(a.path, { method: 'POST', body: a.body });
        online = true;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 401)) {
          online = e.status !== 0 ? online : false;
          break;
        }
        problems = [...problems, { action: a, code: e instanceof ApiError ? e.code : 'UNKNOWN' }];
      }
      queue = queue.slice(1);
      await save();
      emit();
      onSent(a);
    }
  } finally {
    sending = false;
    emit();
  }
}

export async function dismissProblem(id: string) {
  problems = problems.filter((p) => p.action.id !== id);
  await save();
  emit();
}

export async function clearOutbox() {
  queue = [];
  problems = [];
  await save();
  emit();
}

export function useOutbox() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
  useEffect(() => {
    void flush();
    const timer = setInterval(() => void flush(), 15_000);
    return () => clearInterval(timer);
  }, []);
  return s;
}
