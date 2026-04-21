import { useCallback, useRef, useState } from 'react';

interface StreamState {
  streaming: boolean;
  abortController: AbortController | null;
}

/**
 * Manages streaming state per conversation. Multiple conversations can
 * stream simultaneously.
 */
export function useStreamManager() {
  const streamsRef = useRef<Map<string, StreamState>>(new Map());
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());

  const isStreaming = useCallback(
    (convId: string): boolean => {
      return streamingIds.has(convId);
    },
    [streamingIds],
  );

  const isAnyStreaming = useCallback((): boolean => {
    return streamingIds.size > 0;
  }, [streamingIds]);

  const startStream = useCallback(
    (convId: string, controller: AbortController) => {
      streamsRef.current.set(convId, {
        streaming: true,
        abortController: controller,
      });
      setStreamingIds((prev) => new Set([...prev, convId]));
    },
    [],
  );

  const endStream = useCallback((convId: string) => {
    streamsRef.current.delete(convId);
    setStreamingIds((prev) => {
      const next = new Set(prev);
      next.delete(convId);
      return next;
    });
  }, []);

  const stopStream = useCallback(
    (convId: string) => {
      const state = streamsRef.current.get(convId);
      if (state?.abortController) {
        state.abortController.abort();
      }
      endStream(convId);
    },
    [endStream],
  );

  const stopAll = useCallback(() => {
    for (const [, state] of streamsRef.current.entries()) {
      if (state.abortController) state.abortController.abort();
    }
    streamsRef.current.clear();
    setStreamingIds(new Set());
  }, []);

  return {
    isStreaming,
    isAnyStreaming,
    startStream,
    endStream,
    stopStream,
    stopAll,
    streamingIds,
  };
}
