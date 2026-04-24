import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import { getVoiceConfig, saveVoiceConfig } from '../../lib/sidecar';

const COPY = {
  en: {
    title: 'VOICE',
    stt: 'Speech-to-Text provider',
    tts: 'Text-to-Speech provider',
    local: 'Local (faster-whisper)',
    groq: 'Groq (cloud)',
    openai_stt: 'OpenAI Whisper',
    edge: 'Edge TTS (free)',
    openai_tts: 'OpenAI TTS',
    groq_key: 'Groq API Key',
    openai_key: 'OpenAI API Key (voice)',
    save: 'Save',
    saving: 'Saving…',
    note: 'Use the microphone button in the chat input to record voice messages.',
  },
  zh: {
    title: '语音',
    stt: '语音转文字',
    tts: '文字转语音',
    local: '本地 (faster-whisper)',
    groq: 'Groq (云端)',
    openai_stt: 'OpenAI Whisper',
    edge: 'Edge TTS (免费)',
    openai_tts: 'OpenAI TTS',
    groq_key: 'Groq API Key',
    openai_key: 'OpenAI API Key (语音)',
    save: '保存',
    saving: '保存中…',
    note: '使用聊天输入框中的麦克风按钮录制语音消息。',
  },
};

interface Props {
  lang: Lang;
}

export default function VoiceSettings({ lang }: Props) {
  const L = COPY[lang];

  const [sttProvider, setSttProvider] = useState('local');
  const [ttsProvider, setTtsProvider] = useState('edge-tts');
  const [groqKey, setGroqKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const cfg = await getVoiceConfig();
      setSttProvider(cfg.stt_provider);
      setTtsProvider(cfg.tts_provider);
    } catch { /* sidecar not ready */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave() {
    setSaving(true);
    try {
      const cfg: Record<string, string> = {
        stt_provider: sttProvider,
        tts_provider: ttsProvider,
      };
      if (groqKey) cfg.groq_api_key = groqKey;
      if (openaiKey) cfg.openai_api_key = openaiKey;
      await saveVoiceConfig(cfg);
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <section className="settings-section">
      <div className="label">{L.title}</div>

      <div className="field">
        <label className="label">{L.stt}</label>
        <select className="select mono" value={sttProvider} onChange={(e) => setSttProvider(e.target.value)}>
          <option value="local">{L.local}</option>
          <option value="groq">{L.groq}</option>
          <option value="openai">{L.openai_stt}</option>
        </select>
      </div>

      <div className="field">
        <label className="label">{L.tts}</label>
        <select className="select mono" value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
          <option value="edge-tts">{L.edge}</option>
          <option value="openai">{L.openai_tts}</option>
        </select>
      </div>

      {sttProvider === 'groq' && (
        <div className="field">
          <label className="label">{L.groq_key}</label>
          <input type="password" className="input mono" value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)} placeholder="gsk_..." spellCheck={false} autoComplete="off" />
        </div>
      )}

      {(sttProvider === 'openai' || ttsProvider === 'openai') && (
        <div className="field">
          <label className="label">{L.openai_key}</label>
          <input type="password" className="input mono" value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-..." spellCheck={false} autoComplete="off" />
        </div>
      )}

      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{L.note}</div>

      <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving}>
        {saving ? L.saving : L.save}
      </Button>
    </section>
  );
}
