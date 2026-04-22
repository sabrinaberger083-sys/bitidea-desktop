import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationWithPreview, Folder } from '../types';
import {
  countPinned,
  createConversation,
  createFolder,
  deleteFolderAndUnlink,
  listConversations,
  listFolders,
  pinConversation,
  renameConversation,
  renameFolder,
  setConversationFolder,
  softDeleteConversation,
  softDeleteMany,
  undoDeleteConversation,
} from '../lib/db';

export interface UndoState {
  ids: string[];
  title: string;
  timer: ReturnType<typeof setTimeout>;
}

export function useConversations(projectId?: string | null) {
  const [allConversations, setAllConversations] = useState<ConversationWithPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations();
      setAllConversations(list);
    } catch (e) {
      console.error('failed to load conversations', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      const list = await listFolders();
      setFolders(list);
    } catch (e) {
      console.error('failed to load folders', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshFolders();
  }, [refresh, refreshFolders]);

  // Filter conversations by project and folder when selected
  const conversations = useMemo(() => {
    let filtered = allConversations;
    if (projectId) {
      filtered = filtered.filter((c) => c.project_id === projectId);
    }
    if (activeFolderId) {
      filtered = filtered.filter((c) => c.folder_id === activeFolderId);
    }
    return filtered;
  }, [allConversations, projectId, activeFolderId]);

  const conversationCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of allConversations) {
      if (c.folder_id) {
        map.set(c.folder_id, (map.get(c.folder_id) ?? 0) + 1);
      }
    }
    return map;
  }, [allConversations]);

  const create = useCallback(
    async (id: string, title: string, projId?: string | null, assistantId?: string | null) => {
      await createConversation(id, title, projId, assistantId);
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

  const addFolder = useCallback(
    async (name: string) => {
      const id = crypto.randomUUID();
      await createFolder(id, name);
      await refreshFolders();
    },
    [refreshFolders],
  );

  const editFolderName = useCallback(
    async (id: string, name: string) => {
      if (!name.trim()) return;
      await renameFolder(id, name.trim());
      await refreshFolders();
    },
    [refreshFolders],
  );

  const removeFolder = useCallback(
    async (id: string) => {
      await deleteFolderAndUnlink(id);
      if (activeFolderId === id) setActiveFolderId(null);
      await refreshFolders();
      await refresh();
    },
    [refreshFolders, refresh, activeFolderId],
  );

  const moveToFolder = useCallback(
    async (convId: string, folderId: string | null) => {
      await setConversationFolder(convId, folderId);
      await refresh();
    },
    [refresh],
  );

  return {
    conversations,
    loading,
    undo,
    folders,
    activeFolderId,
    conversationCounts,
    refresh,
    refreshFolders,
    create,
    rename,
    pin,
    remove,
    removeMany,
    undoDelete,
    dismissUndo,
    addFolder,
    editFolderName,
    removeFolder,
    moveToFolder,
    setActiveFolderId,
  };
}
