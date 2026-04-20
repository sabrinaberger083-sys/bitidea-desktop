import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { AssistantEvent, Message } from '../../types';
import ToolCard from './ToolCard';
import ThinkingBlock from './ThinkingBlock';
import StepIndicator from './StepIndicator';
import StatusLine from './StatusLine';
import './Message.css';

interface Props {
  message: Message;
}

/** Render a text-only assistant bubble (back-compat for messages that don't
 *  have an event stream — e.g. first-paint fallback or legacy history). */
function TextBubble({ message }: Props) {
  return (
    <>
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {message.content || (message.streaming ? '▍' : '')}
        </ReactMarkdown>
      </div>
      {message.streaming && message.content && (
        <span className="msg-caret" aria-hidden>▍</span>
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
}: {
  events: AssistantEvent[];
  streaming?: boolean;
}) {
  const lastIdx = events.length - 1;

  return (
    <div className="msg-events">
      {events.map((ev, i) => {
        if (ev.kind === 'text') {
          const isLast = i === lastIdx;
          return (
            <div key={`t-${i}`} className="msg-event msg-event-text md">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {ev.text || (streaming && isLast ? '▍' : '')}
              </ReactMarkdown>
              {streaming && isLast && ev.text && (
                <span className="msg-caret" aria-hidden>▍</span>
              )}
            </div>
          );
        }
        if (ev.kind === 'thinking') {
          const isLast = i === lastIdx;
          return (
            <div key={`think-${i}`} className="msg-event">
              <ThinkingBlock text={ev.text} live={!!streaming && isLast} />
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
    </div>
  );
}

function MessageComponent({ message }: Props) {
  const isUser = message.role === 'user';
  const hasEvents = !isUser && !!message.events && message.events.length > 0;

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
        <div className={`msg-bubble ${isUser ? 'bubble-user' : 'bubble-asst'}`}>
          {isUser ? (
            <div className="msg-plain">{message.content}</div>
          ) : hasEvents ? (
            <EventStream events={message.events!} streaming={message.streaming} />
          ) : (
            <TextBubble message={message} />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MessageComponent, (a, b) => {
  const m1 = a.message;
  const m2 = b.message;
  // Cheap identity check first; then compare the shallow fields that our
  // renderer actually reads.
  if (m1 === m2) return true;
  return (
    m1.id === m2.id &&
    m1.content === m2.content &&
    !!m1.streaming === !!m2.streaming &&
    m1.events === m2.events &&
    m1.step === m2.step &&
    m1.status === m2.status
  );
});
