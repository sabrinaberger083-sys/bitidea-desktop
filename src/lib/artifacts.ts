/* ══════════════════════════════════════════════════════════
   Artifact detection & extraction
   ══════════════════════════════════════════════════════════
   Parses fenced code blocks from assistant markdown and
   identifies renderable ones (HTML, SVG, Mermaid).            */

export interface Artifact {
  id: string;
  language: string;
  code: string;
  title?: string;
}

export type RenderableLanguage = 'html' | 'svg' | 'mermaid';

const RENDERABLE: Set<string> = new Set(['html', 'svg', 'mermaid']);

export function isRenderable(lang: string): lang is RenderableLanguage {
  return RENDERABLE.has(lang.toLowerCase());
}

/** Extract all fenced code blocks from markdown text. */
export function extractArtifacts(markdown: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const regex = /```(\w+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const language = match[1].toLowerCase();
    const code = match[2].trim();
    if (!code) continue;
    const id = simpleHash(code);
    const title = extractTitle(language, code);
    artifacts.push({ id, language, code, title });
  }
  return artifacts;
}

/** Extract renderable artifacts only. */
export function extractRenderableArtifacts(markdown: string): Artifact[] {
  return extractArtifacts(markdown).filter((a) => isRenderable(a.language));
}

/** Strip <script> tags and inline event handlers from SVG. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return 'art_' + Math.abs(h).toString(36);
}

function extractTitle(lang: string, code: string): string | undefined {
  if (lang === 'html') {
    const m = code.match(/<title>(.*?)<\/title>/i);
    if (m) return m[1];
  }
  if (lang === 'mermaid') {
    const first = code.split('\n')[0].trim();
    return first || undefined;
  }
  return undefined;
}
