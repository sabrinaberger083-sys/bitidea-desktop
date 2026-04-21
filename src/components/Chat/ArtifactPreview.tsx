import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artifact, RenderableLanguage } from '../../lib/artifacts';
import { isRenderable, sanitizeSvg } from '../../lib/artifacts';
import './ArtifactPreview.css';

interface Props {
  artifact: Artifact;
  onClose: () => void;
}

const LANG_LABELS: Record<RenderableLanguage, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
};

function buildHtmlSrcdoc(code: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { margin: 0; padding: 16px; background: #fff; color: #111; font-family: system-ui, sans-serif; }
</style></head>
<body>${code}</body>
</html>`;
}

function buildMermaidSrcdoc(code: string): string {
  const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; background: #fff; display: flex; justify-content: center; }
  #mermaid-container { width: 100%; }
  .error { color: #ef4444; font-family: monospace; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="mermaid-container">
  <pre class="mermaid">${escaped}</pre>
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<script>
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
<\/script>
</body>
</html>`;
}

export default function ArtifactPreview({ artifact, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const lang = artifact.language.toLowerCase() as RenderableLanguage;
  const label = isRenderable(lang) ? LANG_LABELS[lang] : artifact.language.toUpperCase();
  const title = artifact.title || label;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may fail in some contexts */
    }
  }, [artifact.code]);

  /* Close on Escape */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let content: React.ReactNode;

  if (lang === 'html') {
    content = (
      <iframe
        className="ap-iframe"
        sandbox="allow-scripts"
        srcDoc={buildHtmlSrcdoc(artifact.code)}
        title={title}
      />
    );
  } else if (lang === 'svg') {
    const safe = sanitizeSvg(artifact.code);
    content = (
      <div
        className="ap-svg-container"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  } else if (lang === 'mermaid') {
    content = (
      <iframe
        className="ap-iframe"
        sandbox="allow-scripts"
        srcDoc={buildMermaidSrcdoc(artifact.code)}
        title={title}
      />
    );
  } else {
    content = <pre className="ap-fallback">{artifact.code}</pre>;
  }

  return (
    <aside className="ap-panel" ref={panelRef}>
      <header className="ap-header">
        <div className="ap-header-left">
          <span className="ap-lang-badge">{label}</span>
          <span className="ap-title">{title}</span>
        </div>
        <div className="ap-header-right">
          <button className="ap-btn" onClick={handleCopy} title="复制代码">
            {copied ? '✓ 已复制' : '复制代码'}
          </button>
          <button className="ap-btn ap-btn-close" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
      </header>
      <div className="ap-body">{content}</div>
    </aside>
  );
}
