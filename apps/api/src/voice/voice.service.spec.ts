import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pcm16ToWav } from './voice.providers';
import { VoiceService } from './voice.service';

describe('VoiceService', () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  function harness() {
    const session = { id: sessionId, conversationId, mode: 'wake', state: 'idle', endedAt: null };
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue({ id: conversationId }), create: jest.fn() },
      voiceSession: { create: jest.fn().mockResolvedValue(session), findUnique: jest.fn().mockResolvedValue(session), update: jest.fn().mockResolvedValue({ ...session, endedAt: new Date() }) },
      voiceEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
      voiceProfile: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    const settings = { getApplicationSettings: jest.fn().mockResolvedValue({ voiceEnabled: true, wakeEnabled: true, voiceDefaultMode: 'wake' }) };
    const tts = { synthesize: jest.fn() };
    const guarded = { get: jest.fn() };
    return { service: new VoiceService(prisma as never, settings as never, tts as never, guarded as never), prisma, settings, tts, guarded };
  }

  it('links a session to an existing Conversation and stores events separately', async () => {
    const { service, prisma } = harness();
    const result = await service.startSession({ conversationId, mode: 'wake' });
    expect(result.conversationId).toBe(conversationId);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.voiceSession.create).toHaveBeenCalledWith({ data: { conversationId, mode: 'wake', state: 'idle' } });
    expect(prisma.voiceEvent.create).toHaveBeenCalledWith({ data: { sessionId, type: 'voice.session.started', data: { mode: 'wake', conversationId } } });
  });

  it('can finish and reopen another VoiceSession on the same Conversation', async () => {
    const { service, prisma } = harness();
    await service.startSession({ conversationId, mode: 'live' });
    await service.endSession(sessionId);
    await service.startSession({ conversationId, mode: 'wake' });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.voiceSession.create).toHaveBeenCalledTimes(2);
    expect(prisma.voiceSession.update).toHaveBeenCalledWith({ where: { id: sessionId }, data: { endedAt: expect.any(Date), state: 'idle' } });
    expect(prisma.voiceEvent.create).toHaveBeenCalledWith({ data: { sessionId, type: 'voice.session.completed', data: {} } });
  });

  it('rejects malformed IDs before they reach PostgreSQL', async () => {
    const { service, prisma } = harness();
    await expect(service.startSession({ conversationId: '../bad' })).rejects.toThrow('UUID');
    await expect(service.getSession('not-a-uuid')).rejects.toThrow('UUID');
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
    expect(prisma.voiceSession.findUnique).not.toHaveBeenCalled();
  });

  it('rejects mode changes disabled by persisted settings without updating the session', async () => {
    const { service, prisma, settings } = harness();
    settings.getApplicationSettings.mockResolvedValueOnce({ voiceEnabled: true, wakeEnabled: false });
    await expect(service.changeMode(sessionId, 'wake')).rejects.toThrow('Wake mode is disabled');
    settings.getApplicationSettings.mockResolvedValueOnce({ voiceEnabled: false, wakeEnabled: true });
    await expect(service.changeMode(sessionId, 'live')).rejects.toThrow('Voice is disabled');
    expect(prisma.voiceSession.update).not.toHaveBeenCalled();
    expect(prisma.voiceEvent.create).not.toHaveBeenCalled();
  });

  it('rejects local and non-HTTPS pack URLs before downloading', async () => {
    const { service, guarded } = harness();
    await expect(service.importProfile({ name: 'Bad', url: 'http://127.0.0.1/voice.pt' })).rejects.toThrow();
    await expect(service.importProfile({ name: 'Bad', url: 'http://example.com/voice.pt' })).rejects.toThrow('HTTPS');
    expect(guarded.get).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing pack path when an ID collides', async () => {
    const { service, guarded, tts } = harness();
    const dir = await mkdtemp(join(tmpdir(), 'luna-voice-test-'));
    const previous = process.env.VOICE_PACKS_DIR;
    process.env.VOICE_PACKS_DIR = dir;
    try {
      const packPath = join(dir, 'pf_existing.pt');
      await writeFile(packPath, 'original pack');
      guarded.get.mockResolvedValue({ status: 200, body: Buffer.concat([Buffer.from('PK'), Buffer.alloc(100)]), finalUrl: 'https://example.com/voice.pt' });
      await expect(service.importProfile({ name: 'Existing', url: 'https://example.com/voice.pt', voiceId: 'pf_existing' })).rejects.toThrow();
      expect(await readFile(packPath, 'utf8')).toBe('original pack');
      expect(tts.synthesize).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.VOICE_PACKS_DIR;
      else process.env.VOICE_PACKS_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('saves WebM recordings in a fixed training category and counts them after reload', async () => {
    const { service } = harness();
    const dir = await mkdtemp(join(tmpdir(), 'luna-training-test-'));
    const previous = process.env.WAKE_TRAINING_DATA_DIR;
    process.env.WAKE_TRAINING_DATA_DIR = dir;
    const file = { originalname: 'example.webm', buffer: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]) } as Express.Multer.File;
    try {
      await expect(service.saveTrainingRecording('../prepared', file)).rejects.toThrow('category must be');
      const saved = await service.saveTrainingRecording('positive', file);
      expect(saved.category).toBe('positive');
      expect(saved.fileName.endsWith('.webm')).toBe(true);
      expect(await readFile(join(dir, 'recordings', 'positive', saved.fileName))).toEqual(file.buffer);
      expect(JSON.parse(await readFile(join(dir, 'recordings', 'positive', saved.fileName.replace(/\.webm$/u, '.json')), 'utf8'))).toMatchObject({ source: 'browser_recording', category: 'positive' });
      expect(await service.trainingRecordingStats()).toEqual({ positive: 1, negative: 0, background: 0, backgroundDurationSeconds: 0 });
    } finally {
      if (previous === undefined) delete process.env.WAKE_TRAINING_DATA_DIR;
      else process.env.WAKE_TRAINING_DATA_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sums browser sidecar and CLI WAV duration without counting synthetic noise', async () => {
    const { service } = harness();
    const dir = await mkdtemp(join(tmpdir(), 'luna-background-test-'));
    const previous = process.env.WAKE_TRAINING_DATA_DIR;
    process.env.WAKE_TRAINING_DATA_DIR = dir;
    const file = { originalname: 'room.webm', buffer: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]) } as Express.Multer.File;
    try {
      await service.saveTrainingRecording('background', file, '92.5');
      await writeFile(join(dir, 'background', 'synthetic_noise.wav'), 'synthetic');
      await writeFile(join(dir, 'background', 'background-room.wav'), pcm16ToWav(Buffer.alloc(64_000)));
      expect(await service.trainingRecordingStats()).toEqual({ positive: 0, negative: 0, background: 2, backgroundDurationSeconds: 94.5 });
      await expect(service.saveTrainingRecording('background', file, '-1')).rejects.toThrow('durationSeconds');
    } finally {
      if (previous === undefined) delete process.env.WAKE_TRAINING_DATA_DIR;
      else process.env.WAKE_TRAINING_DATA_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
