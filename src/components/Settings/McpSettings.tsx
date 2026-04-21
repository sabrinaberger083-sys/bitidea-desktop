import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import {
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  toggleMcpServer,
  type McpServer,
} from '../../lib/sidecar';
import { SETTINGS_COPY } from './copy';

interface Props {
  lang: Lang;
}

export default function McpSettings({ lang }: Props) {
  const L = SETTINGS_COPY[lang];

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  /* ── Form state ── */
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envText, setEnvText] = useState('');
  const [formErr, setFormErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listMcpServers();
      setServers(list);
    } catch {
      /* sidecar may not be ready yet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd() {
    const trimName = name.trim();
    const trimCmd = command.trim();
    if (!trimName || !trimCmd) {
      setFormErr(lang === 'zh' ? '名称和命令不能为空' : 'Name and command are required');
      return;
    }
    setFormErr(null);

    const id = trimName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const argsList = args
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }

    try {
      await addMcpServer({ id, name: trimName, command: trimCmd, args: argsList, env, enabled: true });
      setName('');
      setCommand('');
      setArgs('');
      setEnvText('');
      setShowForm(false);
      await refresh();
    } catch (e) {
      setFormErr((e as Error).message);
    }
  }

  async function handleToggle(id: string) {
    try {
      await toggleMcpServer(id);
      await refresh();
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeMcpServer(id);
      await refresh();
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="settings-section">
      <div className="label">{L.section_mcp}</div>

      {servers.length === 0 && !loading && (
        <div className="dim" style={{ fontSize: 13 }}>
          {L.mcp_no_servers}
        </div>
      )}

      {servers.map((s) => (
        <div key={s.id} className="mcp-server-row">
          <div className="mcp-server-info">
            <div className="mcp-server-name mono">{s.name}</div>
            <div className="mcp-server-meta dim">
              <span className="mono" style={{ fontSize: 12 }}>{s.command} {s.args.join(' ')}</span>
              {' · '}
              <span style={{ color: s.running ? 'var(--success)' : 'var(--ink-faint)' }}>
                {s.running ? L.mcp_running : L.mcp_stopped}
              </span>
              {s.running && s.tool_count != null && s.tool_count > 0 && (
                <span> · {s.tool_count} {L.mcp_tools}</span>
              )}
            </div>
          </div>
          <div className="mcp-server-actions">
            <label className="mcp-toggle-label">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={() => handleToggle(s.id)}
                className="mcp-toggle-input"
              />
              <span className="mcp-toggle-track">
                <span className="mcp-toggle-thumb" />
              </span>
            </label>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDelete(s.id)}
            >
              {L.mcp_delete}
            </Button>
          </div>
        </div>
      ))}

      {showForm ? (
        <div className="mcp-form">
          <div className="field">
            <label className="label">{L.mcp_name}</label>
            <input
              className="input mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="filesystem"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="label">{L.mcp_command}</label>
            <input
              className="input mono"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="label">{L.mcp_args}</label>
            <input
              className="input mono"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y, @modelcontextprotocol/server-filesystem, /tmp"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="label">{L.mcp_env}</label>
            <textarea
              className="input mono"
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="KEY=value"
              rows={2}
              spellCheck={false}
              style={{ resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
          {formErr && (
            <div className="dim" style={{ color: 'var(--danger)', fontSize: 12 }}>
              {formErr}
            </div>
          )}
          <div className="mcp-form-buttons">
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>
              {L.cancel}
            </Button>
            <Button variant="primary" size="sm" onClick={handleAdd}>
              {L.mcp_add}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
          + {L.mcp_add}
        </Button>
      )}
    </section>
  );
}
