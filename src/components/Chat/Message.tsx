import { memo, useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { AssistantEvent, Attachment, Message, ThinkingEvent } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import { extractRenderableArtifacts, isRenderable } from '../../lib/artifacts';
import { synthesizeSpeech } from '../../lib/sidecar';
import ToolCard from './ToolCard';
import ThinkingBlock from './ThinkingBlock';
import StepIndicator from './StepIndicator';
import StatusLine from './StatusLine';
import './Message.css';

interface Props {
  message: Message;
  onPreviewArtifact?: (artifact: Artifact) => void;
}

type RenderedEvent = Exclude<AssistantEvent, ThinkingEvent>;

/**
 * Build a custom `pre` renderer that detects renderable code blocks
 * and injects a "预览" button above them.
 */
function usePreWithPreview(
  artifacts: Artifact[],
  onPreview?: (artifact: Artifact) => void,
) {
  return useCallback(
    (props: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) => {
      const { children, ...rest } = props;

      // ReactMarkdown wraps code in <pre><code className="language-xxx">…</code></pre>
      // Try to extract the language from the child <code> element.
      let lang = '';
      let codeText = '';

      const child = Array.isArray(children) ? children[0] : children;
      if (child && typeof child === 'object' && 'props' in (child as any)) {
        const codeProps = (child as any).props;
        const className: string = codeProps?.className || '';
        const langMatch = className.match(/language-(\w+)/);
        if (langMatch) lang = langMatch[1].toLowerCase();

        // Extract raw text from the code element's children
        const extractText = (node: any): string => {
          if (typeof node === 'string') return node;
          if (Array.isArray(node)) return node.map(extractText).join('');
          if (node?.props?.children) return extractText(node.props.children);
          return '';
        };
        codeText = extractText(codeProps?.children).trim();
      }

      if (lang && isRenderable(lang) && codeText && onPreview) {
        // Find the matching artifact by language + content
        const artifact = artifacts.find(
          (a) => a.language === lang && a.code === codeText,
        );

        if (artifact) {
          return (
            <div className="msg-code-wrap">
              <div className="msg-code-toolbar">
                <span className="msg-code-lang">{lang.toUpperCase()}</span>
                <button
                  className="msg-preview-btn"
                  onClick={() => onPreview(artifact)}
                  title="预览"
                >
                  预览 ▶
                </button>
              </div>
              <pre {...rest}>{children}</pre>
            </div>
          );
        }
      }

      return <pre {...rest}>{children}</pre>;
    },
    [artifacts, onPreview],
  );
}

/** Shared markdown options for both rendering modes. */
function MarkdownBlock({
  text,
  artifacts,
  onPreview,
}: {
  text: string;
  artifacts: Artifact[];
  onPreview?: (artifact: Artifact) => void;
}) {
  const PreComponent = usePreWithPreview(artifacts, onPreview);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={onPreview ? { pre: PreComponent as any } : undefined}
    >
      {text}
    </ReactMarkdown>
  );
}

/** Render a text-only assistant bubble (back-compat for messages that don't
 *  have an event stream -- e.g. first-paint fallback or legacy history). */
function TextBubble({
  message,
  onPreviewArtifact,
}: Props) {
  const text = message.content || (message.streaming ? '▍' : '');
  const artifacts = useMemo(
    () => (onPreviewArtifact ? extractRenderableArtifacts(text) : []),
    [text, onPreviewArtifact],
  );

  return (
    <>
      {message.streaming ? (
        <div className="msg-plain msg-plain-stream">
          {message.content}
          {message.content && <span className="msg-caret" aria-hidden>▍</span>}
        </div>
      ) : (
        <div className="md">
          <MarkdownBlock
            text={text}
            artifacts={artifacts}
            onPreview={onPreviewArtifact}
          />
        </div>
      )}
    </>
  );
}

/** Render a stream of mixed events (text tokens, thinking blocks, tool
 *  cards) in chronological order. Text blocks are each their own markdown
 *  block so `- item` lists etc. render correctly. */
function EventStream({
  events,
  streaming,
  statusText,
  onPreviewArtifact,
}: {
  events: AssistantEvent[];
  streaming?: boolean;
  statusText?: string;
  onPreviewArtifact?: (artifact: Artifact) => void;
}) {
  const contentEvents = useMemo(
    () => {
      const merged: RenderedEvent[] = [];
      for (const ev of events) {
        if (ev.kind === 'thinking') continue;
        const last = merged[merged.length - 1];
        if (ev.kind === 'text' && last?.kind === 'text') {
          merged[merged.length - 1] = {
            kind: 'text',
            text: last.text + ev.text,
          };
          continue;
        }
        merged.push(ev);
      }
      return merged;
    },
    [events],
  );
  const thinkingText = useMemo(
    () => events
      .filter((e): e is ThinkingEvent => e.kind === 'thinking')
      .map((e) => e.text)
      .join(''),
    [events],
  );
  const lastIdx = contentEvents.length - 1;

  // Collect all text to extract artifacts once
  const fullText = useMemo(
    () => contentEvents.filter((e) => e.kind === 'text').map((e) => (e as any).text).join(''),
    [contentEvents],
  );
  const artifacts = useMemo(
    () => (onPreviewArtifact ? extractRenderableArtifacts(fullText) : []),
    [fullText, onPreviewArtifact],
  );

  return (
    <div className="msg-events">
      {contentEvents.map((ev, i) => {
        if (ev.kind === 'text') {
          const isLast = i === lastIdx;
          if (streaming) {
            return (
              <div key={`t-${i}`} className="msg-event msg-event-plain">
                <div className="msg-plain msg-plain-stream">
                  {ev.text}
                  {isLast && ev.text && (
                    <span className="msg-caret" aria-hidden>▍</span>
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={`t-${i}`} className="msg-event msg-event-text md">
              <MarkdownBlock
                text={ev.text || (streaming && isLast ? '▍' : '')}
                artifacts={artifacts}
                onPreview={onPreviewArtifact}
              />
              {streaming && isLast && ev.text && (
                <span className="msg-caret" aria-hidden>▍</span>
              )}
            </div>
          );
        }
        // tool
        return (
          <div key={`tool-${ev.id}`} className="msg-event">
            <ToolCard tool={ev} />
          </div>
        );
      })}
      {(thinkingText.trim() || streaming) && (
        <div key="thinking-panel" className="msg-event">
          <ThinkingBlock
            text={thinkingText}
            live={!!streaming}
            statusText={statusText}
          />
        </div>
      )}
    </div>
  );
}

function AttachmentStrip({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="msg-attachments">
      {attachments.map((att) => (
        <div key={att.id} className={att.type === 'image' ? 'msg-att-img' : 'msg-att-file'}>
          {att.type === 'image' ? (
            <img
              src={`data:${att.mime};base64,${att.data}`}
              alt={att.name}
              className="msg-att-thumb"
            />
          ) : (
            <div className="msg-att-chip">
              <span className="msg-att-icon">{att.name.endsWith('.pdf') ? '📄' : '📝'}</span>
              <span className="msg-att-name">{att.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SpeakButton({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);

  async function handleSpeak() {
    if (playing || !text.trim()) return;
    setPlaying(true);
    try {
      const result = await synthesizeSpeech(text);
      if (result.ok && result.audio_base64) {
        const audio = new Audio(`data:audio/mp3;base64,${result.audio_base64}`);
        audio.onended = () => setPlaying(false);
        audio.onerror = () => setPlaying(false);
        await audio.play();
        return;
      }
    } catch { /* ignore */ }
    setPlaying(false);
  }

  return (
    <button
      type="button"
      className="msg-speak-btn"
      onClick={handleSpeak}
      disabled={playing}
      title={playing ? 'Playing…' : 'Read aloud'}
      aria-label="Read aloud"
    >
      {playing ? '⏸' : '🔊'}
    </button>
  );
}

function MessageComponent({ message, onPreviewArtifact }: Props) {
  const isUser = message.role === 'user';
  const hasEvents = !isUser && ((message.events?.length ?? 0) > 0 || !!message.streaming);
  const userText = isUser ? (message.content ?? '').trim() : '';
  const compactUserBubble = isUser
    && !message.attachments?.length
    && !!userText
    && !userText.includes('\n')
    && userText.replace(/\s+/g, ' ').length <= 12;
  const bubbleClassName = [
    'msg-bubble',
    isUser ? 'bubble-user' : 'bubble-asst',
    compactUserBubble ? 'bubble-user-compact' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`msg ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      {!isUser && (
        <div className="msg-avatar" aria-hidden>
          ◆
        </div>
      )}
      <div className="msg-body">
        {!isUser && (message.step || message.status) && (
          <div className="msg-meta">
            <StepIndicator step={message.step} active={!!message.streaming} />
            <StatusLine text={message.streaming ? message.status : undefined} />
          </div>
        )}
        <div className={bubbleClassName}>
          {isUser ? (
            <>
              {message.attachments && message.attachments.length > 0 && (
                <AttachmentStrip attachments={message.attachments} />
              )}
              {message.content && <div className="msg-plain">{message.content}</div>}
            </>
          ) : hasEvents ? (
            <EventStream
              events={message.events!}
              streaming={message.streaming}
              statusText={message.status}
              onPreviewArtifact={onPreviewArtifact}
            />
          ) : (
            <TextBubble message={message} onPreviewArtifact={onPreviewArtifact} />
          )}
        </div>
        {!isUser && !message.streaming && message.content && (
          <div className="msg-actions">
            <SpeakButton text={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageComponent, (a, b) => {
  const m1 = a.message;
  const m2 = b.message;
  // Cheap identity check first; then compare the shallow fields that our
  // renderer actually reads.
  if (m1 === m2 && a.onPreviewArtifact === b.onPreviewArtifact) return true;
  return (
    m1.id === m2.id &&
    m1.content === m2.content &&
    !!m1.streaming === !!m2.streaming &&
    m1.events === m2.events &&
    m1.step === m2.step &&
    m1.status === m2.status &&
    m1.attachments === m2.attachments &&
    a.onPreviewArtifact === b.onPreviewArtifact
  );
});
