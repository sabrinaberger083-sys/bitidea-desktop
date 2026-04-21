import { useCallback, useEffect, useState } from 'react';
import type { ConversationWithPreview } from '../types';
import {
  countPinned,
  createConversation,
  listConversations,
  pinConversation,
  renameConversation,
  softDeleteConversation,
  softDeleteMany,
  undoDeleteConversation,
} from '../lib/db';

export interface UndoState {
  ids: string[];
  title: string;
  timer: ReturnType<typeof setTimeout>;
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationWithPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
    } catch (e) {
      console.error('failed to load conversations', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (id: string, title: string) => {
      await createConversation(id, title);
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      if (!title.trim()) return;
      await renameConversation(id, title.trim());
      await refresh();
    },
    [refresh],
  );

  const pin = useCallback(
    async (id: string, value: boolean): Promise<boolean> => {
      if (value) {
        const n = await countPinned();
        if (n >= 5) return false;
      }
      await pinConversation(id, value);
      await refresh();
      return true;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string, title: string) => {
      if (undo) clearTimeout(undo.timer);
      await softDeleteConversation(id);
      await refresh();
      const timer = setTimeout(() => setUndo(null), 5000);
      setUndo({ ids: [id], title, timer });
    },
    [refresh, undo],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (undo) clearTimeout(undo.timer);
      await softDeleteMany(ids);
      await refresh();
      const timer = setTimeout(() => setUndo(null), 5000);
      setUndo({ ids, title: `${ids.length} conversations`, timer });
    },
    [refresh, undo],
  );

  const undoDelete = useCallback(async () => {
    if (!undo) return;
    clearTimeout(undo.timer);
    for (const id of undo.ids) {
      await undoDeleteConversation(id);
    }
    setUndo(null);
    await refresh();
  }, [undo, refresh]);

  const dismissUndo = useCallback(() => {
    if (!undo) return;
    clearTimeout(undo.timer);
    setUndo(null);
  }, [undo]);

  return {
    conversations,
    loading,
    undo,
    refresh,
    create,
    rename,
    pin,
    remove,
    removeMany,
    undoDelete,
    dismissUndo,
  };
}
