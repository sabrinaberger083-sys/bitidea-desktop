import { useMemo, useState } from 'react';
import Button from '../common/Button';
import type { Lang, Provider } from '../../types';
import { saveConfig, testConnection } from '../../lib/sidecar';

const COPY = {
  en: {
    label: 'STEP 03 · API KEY',
    title: 'Drop in your API key',
    sub: 'Stored locally (0600) at ~/.bitidea-desktop/config.json. Never uploaded.',
    back: 'BACK',
    finish: 'FINISH',
    test: 'Test connection',
    testing: 'Testing…',
    saving: 'Saving…',
    ok: 'connection OK',
    bad: 'connection failed',
    key: 'API KEY',
    model: 'MODEL',
    base: 'BASE URL',
    placeholderKey: 'sk-…',
    placeholderBase: 'https://my-llm.example.com',
  },
  zh: {
    label: '步骤 03 · API KEY',
    title: '填入你的 API Key',
    sub: '仅保存在本机（0600 权限，~/.bitidea-desktop/config.json），不会上传。',
    back: '返回',
    finish: '完成',
    test: '测试连接',
    testing: '测试中…',
    saving: '保存中…',
    ok: '连接成功',
    bad: '连接失败',
    key: 'API KEY',
    model: '模型',
    base: '自定义 Base URL',
    placeholderKey: 'sk-…',
    placeholderBase: 'https://my-llm.example.com',
  },
};

const DEFAULT_MODELS: Record<Provider, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
  openrouter: [
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash-001',
  ],
  anthropic: [
    'claude-sonnet-4-6-latest',
    'claude-opus-4-latest',
    'claude-3-5-haiku-latest',
  ],
  custom: ['gpt-4o-mini'],
};

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'err'; msg: string };

interface Props {
  lang: Lang;
  provider: Provider;
  onBack: () => void;
  onComplete: () => void;
}

export default function StepApiKey({
  lang,
  provider,
  onBack,
  onComplete,
}: Props) {
  const L = COPY[lang];
  const models = useMemo(() => DEFAULT_MODELS[provider], [provider]);

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(models[0]);
  const [baseUrl, setBaseUrl] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  const canSubmit =
    apiKey.trim().length > 0 &&
    model.trim().length > 0 &&
    (provider !== 'custom' || baseUrl.trim().length > 0);

  async function runTest() {
    if (!canSubmit) return;
    setTest({ kind: 'testing' });
    try {
      const res = await testConnection({
        provider,
        model,
        api_key: apiKey,
        base_url: provider === 'custom' ? baseUrl : undefined,
      });
      setTest(res.ok ? { kind: 'ok' } : { kind: 'err', msg: res.error || L.bad });
    } catch (e) {
      setTest({ kind: 'err', msg: (e as Error).message });
    }
  }

  async function runFinish() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await saveConfig({
        provider,
        model,
        api_key: apiKey,
        base_url: provider === 'custom' ? baseUrl : undefined,
      });
      onComplete();
    } catch (e) {
      setTest({ kind: 'err', msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <div className="onb-step-head">
        <div className="section-label">{L.label}</div>
        <h2 className="onb-step-title">{L.title}</h2>
        <p className="onb-step-sub">{L.sub}</p>
      </div>

      <form
        className="onb-form"
        onSubmit={(e) => {
          e.preventDefault();
          runFinish();
        }}
      >
        <div className="field">
          <label className="label">{L.key}</label>
          <input
            type="password"
            className="input mono"
            placeholder={L.placeholderKey}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {provider === 'custom' && (
          <div className="field">
            <label className="label">{L.base}</label>
            <input
              type="url"
              className="input mono"
              placeholder={L.placeholderBase}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        <div className="field">
          <label className="label">{L.model}</label>
          <select
            className="select mono"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="onb-test-row">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canSubmit || test.kind === 'testing'}
            onClick={runTest}
          >
            {test.kind === 'testing' ? L.testing : L.test}
          </Button>
          {test.kind === 'ok' && <span className="onb-test-ok">✓ {L.ok}</span>}
          {test.kind === 'err' && (
            <span className="onb-test-err" title={test.msg}>
              ✗ {L.bad}: {test.msg.slice(0, 80)}
            </span>
          )}
        </div>

        <div className="onb-nav">
          <Button type="button" variant="secondary" onClick={onBack}>
            ← {L.back}
          </Button>
          <Button
            type="submit"
            variant="primary"
            arrow
            disabled={!canSubmit || saving}
          >
            {saving ? L.saving : L.finish}
          </Button>
        </div>
      </form>
    </div>
  );
}
