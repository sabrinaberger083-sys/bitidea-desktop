import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import {
  getMemoryStatus,
  saveMemoryConfig,
  getMemoryEntries,
  type MemoryStatus,
} from '../../lib/sidecar';

const COPY = {
  en: {
    title: 'MEMORY',
    enabled: 'Enable memory system',
    provider: 'Provider',
    builtin: 'Built-in (MEMORY.md)',
    honcho: 'Honcho (AI user modeling)',
    recall: 'Recall mode',
    hybrid: 'Hybrid',
    context: 'Context',
    tools: 'Tools',
    honcho_key: 'Honcho API Key',
    honcho_connected: 'Connected',
    honcho_disconnected: 'Not connected',
    save: 'Save',
    saving: 'Saving…',
    memory_content: 'Memory content',
    user_content: 'User profile',
    empty: '(empty)',
  },
  zh: {
    title: '记忆系统',
    enabled: '启用记忆系统',
    provider: '提供方',
    builtin: '内置 (MEMORY.md)',
    honcho: 'Honcho (AI 用户画像)',
    recall: '召回模式',
    hybrid: '混合',
    context: '上下文',
    tools: '工具',
    honcho_key: 'Honcho API Key',
    honcho_connected: '已连接',
    honcho_disconnected: '未连接',
    save: '保存',
    saving: '保存中…',
    memory_content: '记忆内容',
    user_content: '用户画像',
    empty: '（空）',
  },
};

interface Props {
  lang: Lang;
}

export default function MemorySettings({ lang }: Props) {
  const L = COPY[lang];

  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState('builtin');
  const [recallMode, setRecallMode] = useState('hybrid');
  const [honchoKey, setHonchoKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [memoryMd, setMemoryMd] = useState<string | null>(null);
  const [userMd, setUserMd] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, entries] = await Promise.all([getMemoryStatus(), getMemoryEntries()]);
      setStatus(s);
      setEnabled(s.enabled);
      setProvider(s.provider);
      setRecallMode(s.recall_mode);
      setMemoryMd(entries.memory_md);
      setUserMd(entries.user_md);
    } catch {
      /* sidecar not ready */
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveMemoryConfig({
        enabled,
        provider,
        honcho_api_key: honchoKey || undefined,
        recall_mode: recallMode,
      });
      await refresh();
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <section className="settings-section">
      <div className="label">{L.title}</div>

      <div className="field">
        <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {L.enabled}
        </label>
      </div>

      {enabled && (
        <>
          <div className="field">
            <label className="label">{L.provider}</label>
            <select className="select mono" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="builtin">{L.builtin}</option>
              <option value="honcho">{L.honcho}</option>
            </select>
          </div>

          <div className="field">
            <label className="label">{L.recall}</label>
            <select className="select mono" value={recallMode} onChange={(e) => setRecallMode(e.target.value)}>
              <option value="hybrid">{L.hybrid}</option>
              <option value="context">{L.context}</option>
              <option value="tools">{L.tools}</option>
            </select>
          </div>

          {provider === 'honcho' && (
            <div className="field">
              <label className="label">{L.honcho_key}</label>
              <input
                type="password"
                className="input mono"
                value={honchoKey}
                onChange={(e) => setHonchoKey(e.target.value)}
                placeholder="hc_..."
                spellCheck={false}
                autoComplete="off"
              />
              <span className="dim" style={{ fontSize: 11 }}>
                {status?.honcho_connected ? `✓ ${L.honcho_connected}` : L.honcho_disconnected}
              </span>
            </div>
          )}

          <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? L.saving : L.save}
          </Button>

          {(memoryMd || userMd) && (
            <div style={{ marginTop: 12 }}>
              {memoryMd && (
                <details>
                  <summary className="label" style={{ cursor: 'pointer' }}>{L.memory_content}</summary>
                  <pre className="mono dim" style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                    {memoryMd || L.empty}
                  </pre>
                </details>
              )}
              {userMd && (
                <details>
                  <summary className="label" style={{ cursor: 'pointer' }}>{L.user_content}</summary>
                  <pre className="mono dim" style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                    {userMd || L.empty}
                  </pre>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
