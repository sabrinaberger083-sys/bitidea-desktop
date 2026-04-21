import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import {
  deleteRoutine,
  getRoutineHistory,
  listRoutines,
  runRoutineNow,
  toggleRoutine,
  upsertRoutine,
  type RoutineConfig,
  type RoutineRunResult,
} from '../../lib/sidecar';
import { SETTINGS_COPY } from './copy';

interface Props {
  lang: Lang;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function statusColor(status: string | null | undefined): string {
  if (status === 'success') return 'var(--success)';
  if (status === 'error') return 'var(--danger)';
  if (status === 'running') return 'var(--accent)';
  return 'var(--ink-faint)';
}

function statusLabel(status: string | null | undefined, L: Record<string, string>): string {
  if (status === 'success') return L.routine_success;
  if (status === 'error') return L.routine_error;
  if (status === 'running') return L.routine_running;
  return '--';
}

function cronLabel(cron: string, L: Record<string, string>): string {
  if (cron.startsWith('*/')) {
    const n = cron.slice(2);
    return `${L.routine_interval.replace('N', n)}`;
  }
  if (cron.includes(':')) {
    return `${L.routine_daily} ${cron}`;
  }
  return cron;
}

export default function RoutinesSettings({ lang }: Props) {
  const L = SETTINGS_COPY[lang];

  const [routines, setRoutines] = useState<RoutineConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<RoutineRunResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* -- Form state -- */
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<'daily' | 'interval'>('daily');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [intervalMinutes, setIntervalMinutes] = useState('30');
  const [formErr, setFormErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listRoutines();
      setRoutines(list);
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
    const trimPrompt = prompt.trim();
    if (!trimName || !trimPrompt) {
      setFormErr(lang === 'zh' ? '名称和提示词不能为空' : 'Name and prompt are required');
      return;
    }
    setFormErr(null);

    const cron = scheduleType === 'daily' ? dailyTime : `*/${intervalMinutes}`;

    try {
      await upsertRoutine({ name: trimName, prompt: trimPrompt, cron });
      setName('');
      setPrompt('');
      setDailyTime('09:00');
      setIntervalMinutes('30');
      setShowForm(false);
      await refresh();
    } catch (e) {
      setFormErr((e as Error).message);
    }
  }

  async function handleToggle(id: string) {
    try {
      await toggleRoutine(id);
      await refresh();
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRoutine(id);
      if (expandedId === id) setExpandedId(null);
      await refresh();
    } catch {
      /* ignore */
    }
  }

  async function handleRunNow(id: string) {
    setRunningId(id);
    try {
      await runRoutineNow(id);
      await refresh();
    } catch {
      /* ignore */
    } finally {
      setRunningId(null);
    }
  }

  async function handleToggleHistory(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setHistory([]);
      return;
    }
    setExpandedId(id);
    setHistoryLoading(true);
    try {
      const h = await getRoutineHistory(id, 5);
      setHistory(h);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="label">{L.section_routines}</div>

      {routines.length === 0 && !loading && (
        <div className="dim" style={{ fontSize: 13 }}>
          {L.routine_no_routines}
        </div>
      )}

      {routines.map((r) => (
        <div key={r.id}>
          <div className="mcp-server-row">
            <div className="mcp-server-info">
              <div className="mcp-server-name mono">{r.name}</div>
              <div className="mcp-server-meta dim">
                <span className="mono" style={{ fontSize: 12 }}>
                  {cronLabel(r.cron, L)}
                </span>
                {r.last_run_at && (
                  <>
                    {' · '}
                    <span style={{ color: statusColor(r.last_status) }}>
                      {statusLabel(r.last_status, L)}
                    </span>
                    {' · '}
                    <span style={{ fontSize: 11 }}>
                      {formatTime(r.last_run_at)}
                    </span>
                  </>
                )}
              </div>
              <div
                className="dim"
                style={{
                  fontSize: 12,
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 220,
                }}
                title={r.prompt}
              >
                {r.prompt}
              </div>
            </div>
            <div className="mcp-server-actions" style={{ flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="mcp-toggle-label">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => handleToggle(r.id)}
                    className="mcp-toggle-input"
                  />
                  <span className="mcp-toggle-track">
                    <span className="mcp-toggle-thumb" />
                  </span>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleRunNow(r.id)}
                  disabled={runningId === r.id}
                >
                  {runningId === r.id ? L.routine_running : L.routine_run_now}
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleToggleHistory(r.id)}
                >
                  {L.routine_history}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(r.id)}
                >
                  {L.routine_delete}
                </Button>
              </div>
            </div>
          </div>

          {/* Expandable history */}
          {expandedId === r.id && (
            <div
              style={{
                padding: '8px 12px',
                borderLeft: '2px solid var(--panel-border)',
                marginLeft: 12,
                marginTop: 4,
                fontSize: 12,
              }}
            >
              {historyLoading && (
                <div className="dim">Loading...</div>
              )}
              {!historyLoading && history.length === 0 && (
                <div className="dim">
                  {lang === 'zh' ? '暂无执行记录' : 'No run history'}
                </div>
              )}
              {!historyLoading && history.map((h) => (
                <div
                  key={`${h.routine_id}-${h.started_at}`}
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--panel-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        color: h.status === 'success' ? 'var(--success)' : 'var(--danger)',
                        fontWeight: 600,
                      }}
                    >
                      {h.status === 'success' ? L.routine_success : L.routine_error}
                    </span>
                    <span className="dim">{formatTime(h.started_at)}</span>
                    <span className="dim">
                      ({Math.round((h.finished_at - h.started_at) / 1000)}s)
                    </span>
                  </div>
                  {h.output && (
                    <div
                      className="mono dim"
                      style={{
                        fontSize: 11,
                        maxHeight: 60,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.4,
                      }}
                    >
                      {h.output.slice(0, 200)}
                      {h.output.length > 200 ? '...' : ''}
                    </div>
                  )}
                  {h.error && (
                    <div style={{ color: 'var(--danger)', fontSize: 11 }}>
                      {h.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {showForm ? (
        <div className="mcp-form">
          <div className="field">
            <label className="label">{L.routine_name}</label>
            <input
              className="input mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={lang === 'zh' ? '每日 TODO 摘要' : 'Daily TODO summary'}
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="label">{L.routine_prompt}</label>
            <textarea
              className="input mono"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                lang === 'zh'
                  ? '检查项目 TODO.md，总结新增事项'
                  : 'Check project TODO.md and summarize new items'
              }
              rows={3}
              spellCheck={false}
              style={{ resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
          <div className="field">
            <label className="label">{L.routine_schedule}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="select mono"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as 'daily' | 'interval')}
                style={{ width: 'auto' }}
              >
                <option value="daily">{L.routine_daily}</option>
                <option value="interval">{L.routine_interval}</option>
              </select>
              {scheduleType === 'daily' ? (
                <input
                  type="time"
                  className="input mono"
                  value={dailyTime}
                  onChange={(e) => setDailyTime(e.target.value)}
                  style={{ width: 120 }}
                />
              ) : (
                <input
                  type="number"
                  className="input mono"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  min={1}
                  max={1440}
                  style={{ width: 80 }}
                />
              )}
            </div>
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
              {L.routine_add}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
          + {L.routine_add}
        </Button>
      )}
    </section>
  );
}
