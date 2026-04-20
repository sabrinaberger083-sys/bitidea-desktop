import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Message } from '../../types';
import './Message.css';

interface Props {
  message: Message;
}

function MessageComponent({ message }: Props) {
  const isUser = message.role === 'user';
  return (
    <div className={`msg ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      {!isUser && (
        <div className="msg-avatar" aria-hidden>
          ◆
        </div>
      )}
      <div className="msg-body">
        <div className={`msg-bubble ${isUser ? 'bubble-user' : 'bubble-asst'}`}>
          {isUser ? (
            <div className="msg-plain">{message.content}</div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MessageComponent, (a, b) => {
  const m1 = a.message;
  const m2 = b.message;
  return (
    m1.id === m2.id &&
    m1.content === m2.content &&
    !!m1.streaming === !!m2.streaming
  );
});
