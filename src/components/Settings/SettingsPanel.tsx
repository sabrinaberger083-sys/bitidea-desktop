import { useEffect, useState } from 'react';
import Button from '../common/Button';
import LangSwitch from '../common/LangSwitch';
import type { Config, Lang, Provider } from '../../types';
import { saveConfig } from '../../lib/sidecar';
import { getPresetsForProvider } from '../../lib/modelPresets';
import { SETTINGS_COPY } from './copy';
import './SettingsPanel.css';

const PROVIDERS: Provider[] = ['openai', 'openrouter', 'anthropic', 'custom'];
const VERSION = '0.1.0';
const GITHUB_URL = 'https://github.com/bitidea/bitidea-agent';

interface Props {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  config: Config | null;
  onConfigChanged: (c: Config) => void;
}

export default function SettingsPanel({
  open,
  onClose,
  lang,
  onLangChange,
  config,
  onConfigChanged,
}: Props) {
  const L = SETTINGS_COPY[lang];

  const [provider, setProvider] = useState<Provider>(config?.provider || 'openai');
  const [model, setModel] = useState<string>(config?.model || '');
  const [baseUrl, setBaseUrl] = useState<string>(config?.base_url || '');
  const [editingKey, setEditingKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync local state when the panel opens against the latest config.
  useEffect(() => {
    if (!open) return;
    setProvider(config?.provider || 'openai');
    setModel(config?.model || '');
    setBaseUrl(config?.base_url || '');
    setEditingKey(false);
    setNewKey('');
    setErr(null);
  }, [open, config]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const rotatingKey = editingKey && newKey.trim().length > 0;
      await saveConfig({
        provider,
        model,
        api_key: rotatingKey ? newKey : undefined,
        base_url: provider === 'custom' ? baseUrl : undefined,
      });
      onConfigChanged({
        provider,
        model,
        base_url: provider === 'custom' ? baseUrl : undefined,
        has_api_key: rotatingKey || !!config?.has_api_key,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className={`settings-backdrop ${open ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`settings-panel ${open ? 'open' : ''}`}
        aria-hidden={!open}
        role="dialog"
        aria-label={L.title}
      >
        <header className="settings-head">
          <div className="mono" style={{ letterSpacing: '0.2em', fontSize: 12, color: 'var(--accent-2)' }}>
            ◆ {L.title}
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={L.close}
          >
            ✕
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <div className="label">{L.section_model}</div>

            <div className="field">
              <label className="label">{L.provider}</label>
              <select
                className="select mono"
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label">{L.model}</label>
              {getPresetsForProvider(provider).length > 0 ? (
                <>
                  <select
                    className="select mono"
                    value={getPresetsForProvider(provider).some((p) => p.id === model) ? model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') setModel(e.target.value);
                    }}
                  >
                    {getPresetsForProvider(provider).map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                    <option value="__custom__">{L.custom_model}</option>
                  </select>
                  {!getPresetsForProvider(provider).some((p) => p.id === model) && (
                    <input
                      className="input mono"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={L.custom_model}
                      spellCheck={false}
                      style={{ marginTop: 6 }}
                    />
                  )}
                </>
              ) : (
                <input
                  className="input mono"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>

            {provider === 'custom' && (
              <div className="field">
                <label className="label">{L.base}</label>
                <input
                  className="input mono"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}

            <div className="field">
              <label className="label">{L.key}</label>
              {!editingKey ? (
                <div className="key-row">
                  <span className="mono dim">
                    {config?.has_api_key ? L.has_key : L.no_key}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingKey(true)}
                  >
                    {L.change_key}
                  </Button>
                </div>
              ) : (
                <div className="key-row">
                  <input
                    className="input mono grow"
                    type="password"
                    value={newKey}
                    autoFocus
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="sk-…"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => { setEditingKey(false); setNewKey(''); }}
                  >
                    {L.cancel}
                  </Button>
                </div>
              )}
            </div>
          </section>

          <section className="settings-section">
            <div className="label">{L.language}</div>
            <LangSwitch lang={lang} onChange={onLangChange} />
          </section>

          <section className="settings-section">
            <div className="label">{L.section_appearance}</div>
            <div className="dim" style={{ fontSize: 13 }}>
              {L.appearance_note}
            </div>
          </section>

          <section className="settings-section">
            <div className="label">{L.section_about}</div>
            <div className="dim" style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div>{L.version}: <span className="mono">{VERSION}</span></div>
              <div>
                {L.github}:{' '}
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  bitidea-agent
                </a>
              </div>
            </div>
          </section>

          {err && (
            <div className="dim" style={{ color: 'var(--danger)', fontSize: 12 }}>
              {err}
            </div>
          )}
        </div>

        <footer className="settings-foot">
          <Button variant="secondary" onClick={onClose}>
            {L.cancel}
          </Button>
          <Button variant="primary" arrow onClick={save} disabled={saving}>
            {saving ? L.saving : L.save}
          </Button>
        </footer>
      </aside>
    </>
  );
}
