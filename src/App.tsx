import { useCallback, useEffect, useState } from 'react';
import BackgroundEffects from './components/common/BackgroundEffects';
import Onboarding from './components/Onboarding/Onboarding';
import ChatWindow from './components/Chat/ChatWindow';
import Button from './components/common/Button';
import Logo from './components/common/Logo';
import { bootstrap, getConfig } from './lib/sidecar';
import type { Config, Lang } from './types';

type Route = 'loading' | 'onboarding' | 'chat' | 'boot-error';

const BOOT_MIN_MS = 1600;

const BOOT_COPY = {
  en: {
    kicker: 'IDEAS INTO ACTION',
    tagline: 'Local-first agent workspace',
    stages: [
      'Warming local engine',
      'Syncing workspace context',
      'Launching Bitidea interface',
    ],
  },
  zh: {
    kicker: '让想法进入执行',
    tagline: '面向本地工作流的智能工作台',
    stages: [
      '唤醒本地引擎',
      '同步工作区上下文',
      '点亮 Bitidea 界面',
    ],
  },
} as const;

const BOOT_ERROR_COPY = {
  en: {
    kicker: 'LOCAL RUNTIME REQUIRED',
    title: 'Cannot reach the Bitidea local service',
    description:
      'The desktop shell started, but the local workspace service did not answer in time.',
    browserHint:
      'This preview is running in a regular browser, so the Tauri desktop bridge is unavailable here.',
    primaryStatus: 'Local service offline',
    secondaryStatus: 'Desktop bridge unavailable',
    browserStatus: 'Browser preview only',
    diagnostic: 'Diagnostic',
    note: 'If this keeps happening in the desktop app, relaunch Bitidea and inspect the sidecar logs.',
    retry: 'Retry',
  },
  zh: {
    kicker: '需要本地运行时',
    title: '无法连接到 Bitidea 本地服务',
    description: '桌面外壳已经启动，但本地工作区服务暂时没有正常响应。',
    browserHint:
      '当前只是普通浏览器预览页，这里没有 Tauri 桌面桥接能力，所以无法真正连上本地服务。',
    primaryStatus: '本地服务离线',
    secondaryStatus: '桌面桥接不可用',
    browserStatus: '当前为浏览器预览',
    diagnostic: '诊断信息',
    note: '如果在桌面 App 里仍然出现这个页面，请重启 Bitidea，并检查 sidecar 日志。',
    retry: '重试',
  },
} as const;

function detectInitialLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const n = navigator.language?.toLowerCase() ?? '';
  return n.startsWith('zh') ? 'zh' : 'en';
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [lang, setLang] = useState<Lang>(detectInitialLang());
  const [route, setRoute] = useState<Route>('loading');
  const [bootError, setBootError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setRoute('loading');
    setBootError(null);
    const minDelay = new Promise<void>((resolve) => {
      setTimeout(resolve, BOOT_MIN_MS);
    });
    try {
      await bootstrap();
      const cfg = await getConfig();
      await minDelay;
      setConfig(cfg);
      setRoute(cfg.has_api_key ? 'chat' : 'onboarding');
    } catch (e) {
      await minDelay;
      setBootError((e as Error).message);
      setRoute('boot-error');
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <>
      <BackgroundEffects />

      {route === 'loading' && <BootSplash lang={lang} />}

      {route === 'boot-error' && (
        <BootError lang={lang} error={bootError} onRetry={loadConfig} />
      )}

      {route === 'onboarding' && (
        <Onboarding lang={lang} onLangChange={setLang} onComplete={loadConfig} />
      )}

      {route === 'chat' && (
        <ChatWindow
          lang={lang}
          onLangChange={setLang}
          config={config}
          onConfigChanged={(c) => setConfig(c)}
        />
      )}
    </>
  );
}

function BootSplash({ lang }: { lang: Lang }) {
  const copy = BOOT_COPY[lang];
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % copy.stages.length);
    }, 460);
    return () => clearInterval(timer);
  }, [copy.stages.length]);

  return (
    <div className="boot-splash">
      <div className="boot-brand-stage">
        <div className="boot-brand-core">
          <div className="boot-brand-orbit boot-brand-orbit-outer" aria-hidden />
          <div className="boot-brand-orbit boot-brand-orbit-inner" aria-hidden />
          <div className="boot-brand-beacon" aria-hidden />
          <Logo size="lg" glow animated />
        </div>

        <div className="boot-brand-copy">
          <div className="boot-brand-kicker mono">{copy.kicker}</div>
          <div className="boot-brand-tagline">{copy.tagline}</div>
        </div>

        <div className="boot-current-status mono">
          <span className="pulse-dot success" aria-hidden />
          <span>{copy.stages[stageIndex]}</span>
        </div>

        <div className="boot-progress" aria-hidden>
          <span
            className="boot-progress-fill"
            style={{ transform: `scaleX(${(stageIndex + 1) / copy.stages.length})` }}
          />
        </div>

        <div className="boot-status-strip" aria-hidden>
          {copy.stages.map((stage, index) => (
            <span
              key={stage}
              className={`boot-status-chip ${
                index === stageIndex ? 'is-current' : index < stageIndex ? 'is-active' : ''
              }`}
            >
              <span className="boot-status-index mono">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="boot-status-label">{stage}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BootError({
  lang,
  error,
  onRetry,
}: {
  lang: Lang;
  error: string | null;
  onRetry: () => void;
}) {
  const copy = BOOT_ERROR_COPY[lang];
  const detail = error?.trim() ?? '';
  const isBrowserPreview =
    /Cannot read properties of undefined \(reading 'invoke'\)|__TAURI__|tauri/i.test(detail);

  return (
    <div className="boot-splash boot-splash-error" role="alert">
      <div className="boot-brand-stage boot-brand-stage-error">
        <div className="boot-error-hero">
          <div className="boot-brand-core boot-error-core">
            <div className="boot-brand-orbit boot-brand-orbit-outer boot-error-orbit" aria-hidden />
            <div className="boot-brand-orbit boot-brand-orbit-inner boot-error-orbit" aria-hidden />
            <div className="boot-brand-beacon boot-error-beacon" aria-hidden />
            <Logo size="lg" glow />
          </div>

          <div className="boot-error-copy">
            <div className="boot-brand-kicker boot-error-kicker mono">{copy.kicker}</div>
            <h1 className="boot-error-title">{copy.title}</h1>
            <p className="boot-error-description">
              {isBrowserPreview ? copy.browserHint : copy.description}
            </p>
          </div>
        </div>

        <div className="boot-error-strip" aria-hidden>
          <span className="boot-error-chip is-danger">
            <span className="pulse-dot danger" />
            <span>{copy.primaryStatus}</span>
          </span>
          <span className="boot-error-chip">
            <span className="pulse-dot warning" />
            <span>{isBrowserPreview ? copy.browserStatus : copy.secondaryStatus}</span>
          </span>
        </div>

        {detail && (
          <div className="boot-error-diagnostic">
            <div className="boot-error-diagnostic-label mono">{copy.diagnostic}</div>
            <pre className="boot-error-diagnostic-body mono">{detail}</pre>
          </div>
        )}

        <div className="boot-error-actions">
          <Button variant="primary" onClick={onRetry}>
            ↻ {copy.retry}
          </Button>
          <p className="boot-error-note">{copy.note}</p>
        </div>
      </div>
    </div>
  );
}
