import { WebSocket } from 'ws';
import { VoiceGateway } from './voice.gateway';

describe('VoiceGateway wake idle', () => {
  it('removes the wake keyword while preserving an immediate spoken command', () => {
    const gateway = new VoiceGateway({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(gateway['withoutWakeWord']('Luna, pesquisa por que a RAM aumentou.', 'Luna')).toBe('pesquisa por que a RAM aumentou.');
    expect(gateway['withoutWakeWord']('Luna.', 'Luna')).toBe('');
    expect(gateway['withoutWakeWord']('LUNAS Qual é a capital da Austrália?', 'Luna')).toBe('Qual é a capital da Austrália?');
    expect(gateway['withoutWakeWord']('Qual é a capital da Austrália?', 'Luna')).toBe('');
    expect(gateway['withoutWakeWord']('aluna está aqui', 'Luna')).toBe('');
    expect(gateway['withoutWakeWord']('Lunaris, pesquisa por que a RAM aumentou.', 'Luna')).toBe('');
    expect(gateway['forSpeech']('A RAM subiu ([Canaltech](https://example.com/a)). **Fonte**: https://example.com/b'))
      .toBe('A RAM subiu (Canaltech). Fonte:');
  });
  it('routes idle audio only through openWakeWord and never through STT, LLM, or TTS', async () => {
    const voice = { state: jest.fn().mockResolvedValue(undefined), event: jest.fn().mockResolvedValue(undefined) };
    const conversations = { addMessageToConversation: jest.fn() };
    const settings = { getApplicationSettings: jest.fn() };
    const wake = { detect: jest.fn().mockResolvedValue({ detected: false, score: 0.01, model: 'luna', timestamp: 1 }), reset: jest.fn(), name: 'openWakeWord' };
    const stt = { transcribe: jest.fn() };
    const tts = { synthesize: jest.fn() };
    const gateway = new VoiceGateway(voice as never, conversations as never, settings as never, wake as never, stt as never, tts as never);
    const client = {
      socket: { readyState: WebSocket.OPEN, send: jest.fn() }, sessionId: 'session-1', conversationId: 'conversation-1', mode: 'wake', state: 'idle',
      audio: [], audioBytes: 0, audioStarted: false, wakeBuffer: [], wakeBytes: 0, wakePreRoll: [], wakeBusy: false,
      lastWakeRejectAt: 0, wakeThreshold: 0.5, wakeKeyword: 'Luna', lastWakeFrameAt: 0, wakeGeneration: 0, generation: 0,
    };
    const audioFrame = gateway['audioFrame'].bind(gateway);
    await audioFrame(client as never, Buffer.alloc(10_240));
    expect(wake.detect).toHaveBeenCalledTimes(4);
    expect(wake.detect.mock.calls.every(([frame]) => frame.length === 2_560)).toBe(true);
    expect(stt.transcribe).not.toHaveBeenCalled();
    expect(conversations.addMessageToConversation).not.toHaveBeenCalled();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(settings.getApplicationSettings).not.toHaveBeenCalled();
    expect(voice.event).not.toHaveBeenCalled();
  });

  it('keeps wake pre-roll so a command spoken immediately after Luna reaches STT', async () => {
    const voice = { state: jest.fn().mockResolvedValue(undefined), event: jest.fn().mockResolvedValue(undefined) };
    const wake = { detect: jest.fn().mockResolvedValue({ detected: true, score: 0.9, model: 'luna', timestamp: 1 }), reset: jest.fn().mockResolvedValue(undefined), name: 'openWakeWord' };
    const gateway = new VoiceGateway(voice as never, {} as never, {} as never, wake as never, {} as never, {} as never);
    const client = {
      socket: { readyState: WebSocket.OPEN, send: jest.fn() }, sessionId: 'session-1', conversationId: 'conversation-1', mode: 'wake', state: 'idle',
      audio: [], audioBytes: 0, audioStarted: false, wakeBuffer: [], wakeBytes: 0, wakePreRoll: [], wakeBusy: false,
      lastWakeRejectAt: 0, wakeThreshold: 0.5, wakeKeyword: 'Luna', lastWakeFrameAt: 0, wakeGeneration: 0, generation: 0,
    };
    await gateway['audioFrame'](client as never, Buffer.alloc(10_240, 7));
    expect(client.state).toBe('listening');
    expect(client.audioBytes).toBe(10_240);
    expect(Buffer.concat(client.audio)).toEqual(Buffer.alloc(10_240, 7));
  });

  it('ignores an in-flight wake result after switching to Live', async () => {
    let finishDetection!: (value: { detected: boolean; score: number; model: string; timestamp: number }) => void;
    const detection = new Promise<{ detected: boolean; score: number; model: string; timestamp: number }>((resolve) => {
      finishDetection = resolve;
    });
    const voice = { state: jest.fn().mockResolvedValue(undefined), event: jest.fn().mockResolvedValue(undefined), changeMode: jest.fn().mockResolvedValue(undefined) };
    const settings = { getApplicationSettings: jest.fn().mockResolvedValue({ wakeThreshold: 0.5, wakeKeyword: 'Luna', wakeVerifierEnabled: false, wakeVerifierModel: null, wakeVerifierThreshold: 0.5 }) };
    const wake = { detect: jest.fn().mockReturnValue(detection), reset: jest.fn().mockResolvedValue(undefined), name: 'openWakeWord' };
    const gateway = new VoiceGateway(voice as never, {} as never, settings as never, wake as never, {} as never, {} as never);
    const client = {
      socket: { readyState: WebSocket.OPEN, send: jest.fn() }, sessionId: 'session-1', conversationId: 'conversation-1', mode: 'wake', state: 'idle',
      audio: [], audioBytes: 0, audioStarted: false, wakeBuffer: [], wakeBytes: 0, wakePreRoll: [], wakeBusy: false,
      lastWakeRejectAt: 0, wakeThreshold: 0.5, wakeKeyword: 'Luna', wakeVerifier: { enabled: false, model: null, threshold: 0.5 },
      lastWakeFrameAt: 0, wakeGeneration: 0, generation: 0,
    };
    const frameTask = gateway['audioFrame'](client as never, Buffer.alloc(2_560));
    await gateway['command'](client as never, JSON.stringify({ type: 'mode.set', mode: 'live' }));
    finishDetection({ detected: true, score: 0.99, model: 'luna', timestamp: 1 });
    await frameTask;
    expect(client.state).toBe('listening');
    expect(voice.event).not.toHaveBeenCalledWith('session-1', 'voice.wake.detected', expect.anything());
  });
});
