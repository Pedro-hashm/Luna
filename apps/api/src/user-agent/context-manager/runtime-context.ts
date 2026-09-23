import type { ChatMessage } from '../../llm/types/types';
import type { RuntimeMessage } from '../types/user-agent.types';

/** Places compact, public Evidence directly after the assistant message it supports. */
export function toRuntimeChatMessages(messages: RuntimeMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    const output: ChatMessage[] = [
      { role: message.role, content: message.content },
    ];

    if (message.role === 'assistant' && message.evidence?.length) {
      output.push({
        role: 'system',
        content:
          'Evidence for the immediately preceding assistant message (trusted source dates and reference IDs):\n' +
          JSON.stringify(message.evidence),
      });
    }

    return output;
  });
}
