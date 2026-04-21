import { useCallback, useRef } from 'react';
import type { Message } from '../types';

/**
 * Stores in-flight messages for conversations that are streaming
 * in the background (user switched away).
 */
export function useBackgroundMessages() {
  const store = useRef<Map<string, Message[]>>(new Map());

  const get = useCallback((convId: string): Message[] | undefined => {
    return store.current.get(convId);
  }, []);

  const set = useCallback((convId: string, messages: Message[]) => {
    store.current.set(convId, messages);
  }, []);

  const update = useCallback(
    (convId: string, fn: (msgs: Message[]) => Message[]) => {
      const current = store.current.get(convId) ?? [];
      store.current.set(convId, fn(current));
    },
    [],
  );

  const remove = useCallback((convId: string) => {
    store.current.delete(convId);
  }, []);

  const has = useCallback((convId: string): boolean => {
    return store.current.has(convId);
  }, []);

  return { get, set, update, remove, has };
}
