import { describe, expect, it, vi } from 'vitest';
import type { ChatRequestMessage } from '@/lib/llm';

vi.mock('@/lib/llm', () => ({
  streamChatCompletionWithTools: vi.fn(),
}));

describe('agent runtime final response recovery', () => {
  it('builds compact retry messages without mutating original history', async () => {
    const { buildFinalResponseRecoveryMessages } = await import('@/lib/agent/runtime');
    const longToolContent = 'x'.repeat(7_000);
    const history: ChatRequestMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'original request' },
    ];

    for (let index = 0; index < 15; index += 1) {
      history.push({
        role: 'assistant',
        content: `assistant-${index}`,
        tool_calls: [
          {
            id: `call-${index}`,
            type: 'function',
            function: {
              name: 'fs.read_file',
              arguments: '{}',
            },
          },
        ],
      });
      history.push({
        role: 'tool',
        tool_call_id: `call-${index}`,
        content: index === 14 ? longToolContent : `tool-${index}`,
      });
    }

    const recoveryMessages = buildFinalResponseRecoveryMessages(history);
    const compactedTool = recoveryMessages.find(
      (message) => message.role === 'tool' && message.tool_call_id === 'call-14'
    );

    expect(recoveryMessages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(recoveryMessages[1]).toEqual({ role: 'user', content: 'original request' });
    expect(recoveryMessages).toHaveLength(27);
    expect(recoveryMessages.at(-1)).toEqual({
      role: 'system',
      content:
        'You have tool results available. Provide a final answer to the user now. Do not return an empty response. Avoid calling more tools unless strictly necessary.',
    });
    expect(compactedTool?.content).toHaveLength(6_000);
    expect(String(compactedTool?.content).endsWith('…')).toBe(true);
    expect(history.at(-1)?.content).toBe(longToolContent);
  });
});
