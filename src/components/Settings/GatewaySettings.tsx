import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import {
  getGatewayStatus,
  startGateway,
  stopGateway,
  saveGatewayConfig,
  type GatewayStatus,
} from '../../lib/sidecar';

const COPY = {
  en: {
    title: 'MESSAGING GATEWAY',
    status: 'Status',
    running: 'Running',
    stopped: 'Stopped',
    start: 'Start Gateway',
    stop: 'Stop Gateway',
    starting: 'Starting…',
    platforms: 'Connected platforms',
    none: 'None',
    telegram: 'Telegram',
    telegram_token: 'Telegram Bot Token',
    telegram_users: 'Allowed user IDs (comma-separated)',
    discord: 'Discord',
    discord_token: 'Discord Bot Token',
    slack: 'Slack',
    slack_bot: 'Slack Bot Token',
    slack_app: 'Slack App Token',
    feishu: 'Feishu / Lark',
    feishu_app_id: 'App ID',
    feishu_app_secret: 'App Secret',
    feishu_verification_token: 'Verification Token',
    feishu_encrypt_key: 'Encrypt Key (optional)',
    save: 'Save config',
    saving: 'Saving…',
    note: 'Configure bot tokens then start the gateway to receive messages from external platforms.',
  },
  zh: {
    title: '消息网关',
    status: '状态',
    running: '运行中',
    stopped: '已停止',
    start: '启动网关',
    stop: '停止网关',
    starting: '启动中…',
    platforms: '已连接平台',
    none: '无',
    telegram: 'Telegram',
    telegram_token: 'Telegram Bot Token',
    telegram_users: '允许的用户 ID（逗号分隔）',
    discord: 'Discord',
    discord_token: 'Discord Bot Token',
    slack: 'Slack',
    slack_bot: 'Slack Bot Token',
    slack_app: 'Slack App Token',
    feishu: '飞书 / Lark',
    feishu_app_id: 'App ID',
    feishu_app_secret: 'App Secret',
    feishu_verification_token: 'Verification Token',
    feishu_encrypt_key: 'Encrypt Key（可选）',
    save: '保存配置',
    saving: '保存中…',
    note: '配置 Bot Token 后启动网关，即可从外部平台接收消息。',
  },
};

interface Props {
  lang: Lang;
}

export default function GatewaySettings({ lang }: Props) {
  const L = COPY[lang];

  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramUsers, setTelegramUsers] = useState('');
  const [discordToken, setDiscordToken] = useState('');
  const [slackBot, setSlackBot] = useState('');
  const [slackApp, setSlackApp] = useState('');
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuVerifyToken, setFeishuVerifyToken] = useState('');
  const [feishuEncryptKey, setFeishuEncryptKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await getGatewayStatus();
      setStatus(s);
    } catch { /* sidecar not ready */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveGatewayConfig({
        telegram_token: telegramToken || undefined,
        telegram_allowed_users: telegramUsers || undefined,
        discord_token: discordToken || undefined,
        slack_bot_token: slackBot || undefined,
        slack_app_token: slackApp || undefined,
        feishu_app_id: feishuAppId || undefined,
        feishu_app_secret: feishuAppSecret || undefined,
        feishu_verification_token: feishuVerifyToken || undefined,
        feishu_encrypt_key: feishuEncryptKey || undefined,
      });
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleToggle() {
    if (status?.running) {
      await stopGateway();
    } else {
      setStarting(true);
      await startGateway();
      setStarting(false);
    }
    await refresh();
  }

  return (
    <section className="settings-section">
      <div className="label">{L.title}</div>

      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{L.note}</div>

      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="label">{L.status}:</span>
        <span className="mono" style={{ color: status?.running ? 'var(--success)' : 'var(--dim)' }}>
          {status?.running ? L.running : L.stopped}
        </span>
        {status?.running && status.platforms.length > 0 && (
          <span className="dim" style={{ fontSize: 11 }}>
            ({status.platforms.join(', ')})
          </span>
        )}
        <Button variant={status?.running ? 'secondary' : 'primary'} size="sm"
          onClick={handleToggle} disabled={starting}>
          {starting ? L.starting : status?.running ? L.stop : L.start}
        </Button>
      </div>

      <details>
        <summary className="label" style={{ cursor: 'pointer', marginBottom: 8 }}>{L.telegram}</summary>
        <div className="field">
          <label className="label">{L.telegram_token}</label>
          <input type="password" className="input mono" value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)} spellCheck={false} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label">{L.telegram_users}</label>
          <input className="input mono" value={telegramUsers}
            onChange={(e) => setTelegramUsers(e.target.value)} placeholder="123456,789012" spellCheck={false} />
        </div>
      </details>

      <details>
        <summary className="label" style={{ cursor: 'pointer', marginBottom: 8 }}>{L.discord}</summary>
        <div className="field">
          <label className="label">{L.discord_token}</label>
          <input type="password" className="input mono" value={discordToken}
            onChange={(e) => setDiscordToken(e.target.value)} spellCheck={false} autoComplete="off" />
        </div>
      </details>

      <details>
        <summary className="label" style={{ cursor: 'pointer', marginBottom: 8 }}>{L.slack}</summary>
        <div className="field">
          <label className="label">{L.slack_bot}</label>
          <input type="password" className="input mono" value={slackBot}
            onChange={(e) => setSlackBot(e.target.value)} placeholder="xoxb-..." spellCheck={false} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label">{L.slack_app}</label>
          <input type="password" className="input mono" value={slackApp}
            onChange={(e) => setSlackApp(e.target.value)} placeholder="xapp-..." spellCheck={false} autoComplete="off" />
        </div>
      </details>

      <details>
        <summary className="label" style={{ cursor: 'pointer', marginBottom: 8 }}>{L.feishu}</summary>
        <div className="field">
          <label className="label">{L.feishu_app_id}</label>
          <input className="input mono" value={feishuAppId}
            onChange={(e) => setFeishuAppId(e.target.value)} placeholder="cli_xxxxxxxx" spellCheck={false} />
        </div>
        <div className="field">
          <label className="label">{L.feishu_app_secret}</label>
          <input type="password" className="input mono" value={feishuAppSecret}
            onChange={(e) => setFeishuAppSecret(e.target.value)} spellCheck={false} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label">{L.feishu_verification_token}</label>
          <input type="password" className="input mono" value={feishuVerifyToken}
            onChange={(e) => setFeishuVerifyToken(e.target.value)} spellCheck={false} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label">{L.feishu_encrypt_key}</label>
          <input type="password" className="input mono" value={feishuEncryptKey}
            onChange={(e) => setFeishuEncryptKey(e.target.value)} spellCheck={false} autoComplete="off" />
        </div>
      </details>

      <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
        {saving ? L.saving : L.save}
      </Button>
    </section>
  );
}
