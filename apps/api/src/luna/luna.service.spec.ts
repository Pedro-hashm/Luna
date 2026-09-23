import { LunaService } from './luna.service';
import type { LunaGenerateInput } from './luna.types';

describe('LunaService', () => {
  it('keeps the exact prompt attached when the model request fails', async () => {
    const providerError = new Error('provider unavailable');
    const chat = jest.fn().mockRejectedValue(providerError);
    const service = new LunaService(
      { chat } as never,
      {
        getApplicationSettings: jest.fn().mockResolvedValue({
          llmCombo: 'local-general',
          llmTemperature: 0.2,
          llmMaxTokens: 1000,
        }),
      } as never,
    );
    const input = {
      context: {
        currentDateTime: '2026-09-23T12:00:00.000-03:00',
        recentMessages: [
          { role: 'user', content: 'O que conversamos hoje?' },
        ],
      },
      finalInstructions: 'Responda usando as fontes retornadas.',
      toolExecutions: [],
    } as unknown as LunaGenerateInput;

    let thrown: unknown;
    try {
      await service.generate(input);
    } catch (error) {
      thrown = error;
    }

    const sentMessages = chat.mock.calls[0]?.[0].messages;
    expect(thrown).toBe(providerError);
    expect(thrown).toMatchObject({
      observabilityPrompt: {
        target: 'luna',
        messages: sentMessages,
      },
    });
  });
});
