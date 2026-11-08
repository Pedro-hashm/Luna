import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordVoiceModule } from './discord-voice.module';
import { ObservabilityModule } from '../observability/observability.module';
import { MemoryModule } from '../memory/memory.module';

type Configuration = { enabled: boolean; guildId: string | null; channelId: string | null; ownerDiscordUserId: string | null };

describe('Discord voice control', () => {
  const guildId = '1234567890123456789';
  const channelId = '2234567890123456789';
  const newGuildId = '3234567890123456789';
  const auth = 'Bearer synthetic-worker-key';
  let app: INestApplication;
  let settings: Configuration | null;

  beforeEach(async () => {
    jest.replaceProperty(process, 'env', { ...process.env, DISCORD_VOICE_WORKER_SECRET: 'synthetic-worker-key' });
    settings = null;
    const discordVoiceSettings = {
      findUnique: jest.fn(async () => settings),
      upsert: jest.fn(async ({ update }: { update: Configuration }) => {
        settings = update;
        return settings;
      }),
    };
    const prisma = {
      discordVoiceSettings,
      $transaction: (run: (tx: { discordVoiceSettings: typeof discordVoiceSettings }) => unknown) =>
        Promise.resolve().then(() => run({ discordVoiceSettings })),
    };
    const fixture = await Test.createTestingModule({
      imports: [PrismaModule, ObservabilityModule, MemoryModule, DiscordVoiceModule],
    }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = fixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('defaults off and accepts only a valid configured server and channel', async () => {
    const http = request(app.getHttpServer());
    await http.get('/discord-voice').expect(200, {
      enabled: false, guildId: null, channelId: null, ownerDiscordUserId: null, status: { state: 'offline', updatedAt: null }, destinations: [],
    });
    await http.patch('/discord-voice').send({ enabled: true }).expect(400);
    await http.patch('/discord-voice').send({ token: 'unused' }).expect(400);
    await http.patch('/discord-voice').send({ guildId: 123 }).expect(400);
    await http.patch('/discord-voice').send({ guildId: '18446744073709551616' }).expect(400);
    await http.patch('/discord-voice').send({ enabled: true, guildId, channelId, ownerDiscordUserId: '4234567890123456789' }).expect(200);
    await http.get('/discord-voice/worker').set('Authorization', auth).expect(200, {
      enabled: true, guildId, channelId, ownerDiscordUserId: '4234567890123456789',
    });

    await http.patch('/discord-voice').send({ guildId: newGuildId }).expect(400);
    await http.get('/discord-voice/worker').set('Authorization', auth).expect(200, {
      enabled: true, guildId, channelId, ownerDiscordUserId: '4234567890123456789',
    });
    await http.patch('/discord-voice').send({ enabled: false, guildId: newGuildId }).expect(200);
    await http.get('/discord-voice/worker').set('Authorization', auth).expect(200, {
      enabled: false, guildId: newGuildId, channelId: null, ownerDiscordUserId: '4234567890123456789',
    });
  });

  it('requires worker authorization and only exposes sanitized fresh status', async () => {
    const http = request(app.getHttpServer());
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const destinations = [{ id: guildId, name: 'Teste', channels: [{ id: channelId, name: 'Voz' }] }];
    await http.get('/discord-voice/worker').expect(401);
    await http.get('/discord-voice/worker').set('Authorization', 'Bearer invalid-worker-key').expect(401);
    await http.post('/discord-voice/worker/turn').send({ transcript: 'texto sintético' }).expect(401);
    await http.post('/discord-voice/worker/status').send({ state: 'ready' }).expect(401);
    await http.post('/discord-voice/worker/status').set('Authorization', auth)
      .send({ state: 'ready', error: 'internal detail' }).expect(400);
    await http.post('/discord-voice/worker/status').set('Authorization', auth)
      .send({ state: 'ready', destinations }).expect(204);
    await http.get('/discord-voice').expect('Cache-Control', 'no-store').expect(200, {
      enabled: false, guildId: null, channelId: null, ownerDiscordUserId: null,
      status: { state: 'ready', updatedAt: new Date(now).toISOString() },
      destinations,
    });

    clock.mockReturnValue(now + 30_000);
    await http.get('/discord-voice').expect(200, {
      enabled: false, guildId: null, channelId: null, ownerDiscordUserId: null,
      status: { state: 'offline', updatedAt: null }, destinations: [],
    });
    delete process.env.DISCORD_VOICE_WORKER_SECRET;
    await http.get('/discord-voice/worker').set('Authorization', auth).expect(401);
  });
});

