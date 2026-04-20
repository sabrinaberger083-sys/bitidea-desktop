import { useCallback, useEffect, useState } from 'react';
import BackgroundEffects from './components/common/BackgroundEffects';
import Onboarding from './components/Onboarding/Onboarding';
import ChatWindow from './components/Chat/ChatWindow';
import Button from './components/common/Button';
import Logo from './components/common/Logo';
import { bootstrap, getConfig } from './lib/sidecar';
import type { Config, Lang } from './types';

type Route = 'loading' | 'onboarding' | 'chat' | 'boot-error';

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
    try {
      await bootstrap();
      const cfg = await getConfig();
      setConfig(cfg);
      setRoute(cfg.has_api_key ? 'chat' : 'onboarding');
    } catch (e) {
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
  return (
    <div className="boot-splash">
      <Logo size="lg" glow />
      <div
        className="mono faint"
        style={{ marginTop: 20, letterSpacing: '0.2em', fontSize: 12 }}
      >
        {lang === 'zh' ? '启动中…' : 'BOOTING…'}
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
  const isZh = lang === 'zh';
  return (
    <div className="boot-splash" role="alert">
      <Logo size="md" />
      <div
        className="mono"
        style={{
          color: 'var(--danger)',
          marginTop: 24,
          fontSize: 13,
          letterSpacing: '0.1em',
        }}
      >
        {isZh ? '无法连接到本地服务' : 'CANNOT REACH SIDECAR'}
      </div>
      {error && (
        <pre
          className="mono faint"
          style={{
            marginTop: 14,
            fontSize: 11,
            maxWidth: 560,
            whiteSpace: 'pre-wrap',
            textAlign: 'center',
          }}
        >
          {error}
        </pre>
      )}
      <div style={{ marginTop: 20 }}>
        <Button variant="secondary" onClick={onRetry}>
          ↻ {isZh ? '重试' : 'RETRY'}
        </Button>
      </div>
    </div>
  );
}
