import type { StoredMessage } from '../types';

export function conversationToMarkdown(
  title: string,
  messages: StoredMessage[],
): string {
  const lines: string[] = [`# ${title}`, ''];

  if (messages.length > 0) {
    const firstDate = new Date(messages[0].created_at).toISOString().split('T')[0];
    lines.push(`_${firstDate}_`, '');
  }

  for (const msg of messages) {
    const heading = msg.role === 'user' ? '## 你' : '## 助手';
    lines.push(heading, '');

    if (msg.role === 'user') {
      lines.push(msg.content, '');
    } else if (msg.events && msg.events.length > 0) {
      for (const ev of msg.events) {
        if (ev.kind === 'text') {
          lines.push(ev.text, '');
        } else if (ev.kind === 'thinking') {
          for (const line of ev.text.split('\n')) {
            lines.push(`> ${line}`);
          }
          lines.push('');
        } else if (ev.kind === 'tool') {
          const lang = ev.name.match(/terminal|shell|bash/) ? 'shell' : 'text';
          lines.push('```' + lang);
          if (ev.preview) lines.push(ev.preview);
          lines.push('```', '');
          if (ev.result?.summary) {
            lines.push(`> result: ${ev.result.summary}`, '');
          }
        }
      }
    } else if (msg.content) {
      lines.push(msg.content, '');
    }

    lines.push('---', '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, 100);
}
