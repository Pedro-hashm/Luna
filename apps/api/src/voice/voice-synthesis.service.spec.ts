import { VoiceSynthesisService, speechSegment } from './voice-synthesis.service';

describe('VoiceSynthesisService', () => {
  it('reads only the saved message in the requested conversation with the configured voice', async () => {
    const findFirst = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: '**Olá**. [Fonte](https://example.com).' });
    const settings = { getApplicationSettings: jest.fn().mockResolvedValue({
      voiceTtsEngine: 'fish', fishAudioReferenceId: 'synthetic-voice', voiceSpeed: 0.9,
    }) };
    const synthesize = jest.fn().mockResolvedValue({ audio: Buffer.from('audio'), mimeType: 'audio/mpeg' });
    const service = new VoiceSynthesisService(
      { message: { findFirst } } as never, settings as never, {} as never, {} as never,
      undefined, undefined, undefined, { name: 'fish-audio', synthesize } as never,
    );
    const signal = new AbortController().signal;
    await expect(service.readMessage('wrong-chat', 'message', 0, signal)).rejects.toThrow('Mensagem não encontrada');
    expect(synthesize).not.toHaveBeenCalled();
    await expect(service.readMessage('chat', 'message', 0, signal)).resolves.toMatchObject({ mimeType: 'audio/mpeg', next: null });
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { id: 'message', conversationId: 'chat', role: { in: ['user', 'assistant'] } }, select: { content: true },
    });
    expect(synthesize).toHaveBeenCalledWith('Olá. Fonte.', 'synthetic-voice', 0.9, signal);
  });

  it('splits long text without dropping characters or breaking a surrogate pair', () => {
    const input = 'a'.repeat(1999) + '🙂' + 'palavra '.repeat(430).trim();
    const first = speechSegment(input, 0);
    expect(first.next).toBe(1999);
    const pieces = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const segment: ReturnType<typeof speechSegment> = speechSegment(input, offset);
      pieces.push(segment.text);
      expect(segment.text.length).toBeLessThanOrEqual(2000);
      offset = segment.next;
    }
    expect(pieces.join('').replaceAll(' ', '')).toBe(input.replaceAll(' ', ''));
  });
});
