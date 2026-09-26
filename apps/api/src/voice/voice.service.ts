import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { GuardedHttpClient } from '../research/providers/extraction/guarded-http.client';
import { validateWebUrl } from '../research/providers/extraction/web-url-safety';
import { SettingsService } from '../settings/settings.service';
import { F5TtsProvider, KokoroTtsProvider, QwenTtsProvider } from './voice.providers';
import type { VoiceMode, VoiceState } from './voice.types';

const PACK_LIMIT = 10_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

@Injectable()
export class VoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tts: KokoroTtsProvider,
    private readonly guardedHttp: GuardedHttpClient,
    @Optional() private readonly qwenTts?: QwenTtsProvider,
    @Optional() private readonly f5Tts?: F5TtsProvider,
  ) {}

  async startSession(input: { conversationId?: string; mode?: VoiceMode }) {
    if (input.conversationId && !UUID.test(input.conversationId)) throw new BadRequestException('conversationId must be a UUID');
    const settings = await this.settings.getApplicationSettings();
    if (!settings.voiceEnabled) throw new BadRequestException('Voice is disabled');
    const mode = input.mode ?? (settings.voiceDefaultMode as VoiceMode);
    if (mode !== 'wake' && mode !== 'live') throw new BadRequestException('mode must be wake or live');
    if (mode === 'wake' && !settings.wakeEnabled) throw new BadRequestException('Wake mode is disabled');
    const conversation = input.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: input.conversationId } })
      : await this.prisma.conversation.create({ data: {} });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const session = await this.prisma.voiceSession.create({ data: { conversationId: conversation.id, mode, state: 'idle' } });
    await this.event(session.id, 'voice.session.started', { mode, conversationId: conversation.id });
    return session;
  }

  async getSession(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('Voice session ID must be a UUID');
    const session = await this.prisma.voiceSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Voice session not found');
    return session;
  }

  async listSessions(conversationId: string) {
    if (!conversationId) throw new BadRequestException('conversationId is required');
    if (!UUID.test(conversationId)) throw new BadRequestException('conversationId must be a UUID');
    return this.prisma.voiceSession.findMany({ where: { conversationId }, orderBy: { startedAt: 'desc' } });
  }

  async sessionEvents(id: string) {
    const session = await this.getSession(id);
    const events = await this.prisma.voiceEvent.findMany({ where: { sessionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { session, events };
  }

  async event(sessionId: string, type: string, data: Record<string, string | number | boolean | null> = {}) {
    return this.prisma.voiceEvent.create({ data: { sessionId, type, data } });
  }

  async state(sessionId: string, state: VoiceState) {
    await this.prisma.voiceSession.update({ where: { id: sessionId }, data: { state } });
    await this.event(sessionId, 'voice.state.changed', { state });
  }

  async changeMode(id: string, mode: VoiceMode) {
    if (mode !== 'wake' && mode !== 'live') throw new BadRequestException('mode must be wake or live');
    const session = await this.getSession(id);
    if (session.endedAt) throw new BadRequestException('Voice session has ended');
    const settings = await this.settings.getApplicationSettings();
    if (!settings.voiceEnabled) throw new BadRequestException('Voice is disabled');
    if (mode === 'wake' && !settings.wakeEnabled) throw new BadRequestException('Wake mode is disabled');
    const changed = await this.prisma.voiceSession.update({ where: { id }, data: { mode, state: 'idle' } });
    await this.event(id, 'voice.mode.changed', { mode });
    return changed;
  }

  async endSession(id: string) {
    const current = await this.getSession(id);
    if (current.endedAt) return current;
    const ended = await this.prisma.voiceSession.update({ where: { id }, data: { endedAt: new Date(), state: 'idle' } });
    await this.event(id, 'voice.session.completed');
    return ended;
  }

  async expireStaleSessions(activeIds: Set<string>) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const stale = await this.prisma.voiceSession.findMany({
      where: { endedAt: null, startedAt: { lt: cutoff }, ...(activeIds.size ? { id: { notIn: [...activeIds] } } : {}) },
      select: { id: true },
      orderBy: { startedAt: 'asc' },
      take: 100,
    });
    for (const session of stale) {
      await this.prisma.voiceSession.update({ where: { id: session.id }, data: { endedAt: new Date(), state: 'idle' } });
      await this.event(session.id, 'voice.session.completed', { reason: 'stale' });
    }
    return stale.length;
  }

  async listProfiles() {
    await this.prisma.voiceProfile.upsert({
      where: { voiceId: 'pf_dora' }, update: {},
      create: { id: 'pf_dora', voiceId: 'pf_dora', name: 'Dora (original)', engine: 'kokoro', source: 'builtin', language: 'p' },
    });
    const profiles = await this.prisma.voiceProfile.findMany({
      where: { engine: 'kokoro', language: 'p', id: { in: ['pf_dora', 'pf_luna_nobre'] } },
      orderBy: { createdAt: 'asc' },
    });
    const settings = await this.settings.getApplicationSettings();
    const selectedProfileId = profiles.some((profile) => profile.id === settings.voiceProfileId) ? settings.voiceProfileId : 'pf_dora';
    if (selectedProfileId !== settings.voiceProfileId) {
      await this.settings.updateSettings({ application: { voiceProfileId: 'pf_dora' } });
    }
    return { profiles, selectedProfileId };
  }

  async selectProfile(id: string) {
    const profile = await this.prisma.voiceProfile.findUnique({ where: { id } });
    if (!profile || profile.engine !== 'kokoro' || profile.language !== 'p') throw new NotFoundException('Brazilian Portuguese Kokoro voice profile not found');
    await this.settings.updateSettings({ application: { voiceProfileId: profile.id } });
    return profile;
  }

  async preview(id: string) {
    const profile = await this.prisma.voiceProfile.findUnique({ where: { id } });
    if (!profile || profile.engine !== 'kokoro' || profile.language !== 'p') throw new NotFoundException('Brazilian Portuguese Kokoro voice profile not found');
    const settings = await this.settings.getApplicationSettings();
    const sample = 'Ah, você chegou. Imagino que tenha feito o melhor que pôde. Ainda assim, deixe comigo; vou cuidar disso com muito mais elegância.';
    try { return await this.tts.synthesize(sample, profile.voiceId, settings.voiceSpeed); }
    catch (error) { throw new ServiceUnavailableException(error instanceof Error ? error.message : `${this.tts.name} unavailable`); }
  }

  async voiceIdForProfile(id: string): Promise<string> {
    const profile = await this.prisma.voiceProfile.findUnique({ where: { id } });
    if (!profile || profile.engine !== 'kokoro' || profile.language !== 'p') throw new NotFoundException('Selected Brazilian Portuguese Kokoro voice profile not found');
    return profile.voiceId;
  }

  async importProfile(input: { name: string; url: string; license?: string; voiceId?: string }) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new BadRequestException('name is required (max 100 characters)');
    let url: URL;
    try { url = validateWebUrl(input.url); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Invalid voice pack URL'); }
    if (url.protocol !== 'https:' || !url.pathname.toLowerCase().endsWith('.pt')) throw new BadRequestException('Voice pack URL must be HTTPS and end in .pt');
    let response: Awaited<ReturnType<GuardedHttpClient['get']>>;
    try { response = await this.guardedHttp.get(url.toString(), { timeoutMs: 30_000, maxBytes: PACK_LIMIT, maxRedirects: 3, httpsOnly: true }); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Could not download voice pack'); }
    if (response.status !== 200) throw new BadRequestException(`Voice download returned HTTP ${response.status}`);
    // Keep the stable URL supplied by the user. CDN redirects may contain
    // expiring signed query parameters that should not enter persistent data.
    return this.installPack({ ...input, bytes: response.body, source: 'downloaded', sourceUrl: url.toString() });
  }

  async importLocalProfile(input: { name: string; license?: string; voiceId?: string }, filename: string, bytes: Buffer) {
    if (!filename.toLowerCase().endsWith('.pt')) throw new BadRequestException('Local voice pack must be a .pt file');
    return this.installPack({ ...input, bytes, source: 'local' });
  }

  private async installPack(input: { name: string; bytes: Buffer; source: 'downloaded' | 'local'; sourceUrl?: string; license?: string; voiceId?: string }) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new BadRequestException('name is required (max 100 characters)');
    const slugBase = input.name.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 54) || 'voice';
    const slug = input.voiceId ?? `pf_${slugBase}_${randomUUID().slice(0, 8)}`;
    if (!/^[abefhijpz][fm]_[A-Za-z0-9_-]{1,80}$/u.test(slug)) throw new BadRequestException('voiceId must use a Kokoro language and gender prefix');
    if (await this.prisma.voiceProfile.findUnique({ where: { id: slug } })) throw new BadRequestException('Voice pack slug already exists');
    const bytes = input.bytes;
    if (bytes.length < 64 || bytes.length > PACK_LIMIT || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new BadRequestException('Voice pack must be a valid-size PyTorch ZIP .pt asset');
    }
    const dir = process.env.VOICE_PACKS_DIR ?? '/voices';
    await mkdir(dir, { recursive: true });
    const filename = `${slug}.pt`;
    const finalPath = join(dir, filename);
    const tempPath = join(dir, `.${randomUUID()}.tmp`);
    await writeFile(tempPath, bytes, { flag: 'wx' });
    let installed = false;
    try {
      await link(tempPath, finalPath);
      installed = true;
      await unlink(tempPath);
      let preview: Awaited<ReturnType<KokoroTtsProvider['synthesize']>>;
      try { preview = await this.tts.synthesize('Olá, eu sou a Luna.', `pack://${slug}`, 1); }
      catch (error) {
        const detail = error instanceof Error ? error.message : 'Kokoro voice preview failed';
        if (detail.includes('unavailable') || detail.includes('timed out')) throw new ServiceUnavailableException(detail);
        throw new BadRequestException(`Kokoro rejected this voice pack: ${detail}`);
      }
      if (!preview.audio.length) throw new BadRequestException('Kokoro generated no audio for this voice pack');
      return await this.prisma.voiceProfile.create({
        data: { id: slug, voiceId: `pack://${slug}`, name: input.name.trim(), engine: 'kokoro', source: input.source, sourceUrl: input.sourceUrl ?? null, license: input.license?.trim() || null, language: slug[0], format: 'pt', assetPath: finalPath, metadata: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } },
      });
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      if (installed) await unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  async deleteProfile(id: string) {
    const profile = await this.prisma.voiceProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('Voice profile not found');
    if (profile.source !== 'downloaded' && profile.source !== 'local') throw new BadRequestException('Built-in voices cannot be deleted');
    const settings = await this.settings.getApplicationSettings();
    if (settings.voiceProfileId === id) await this.settings.updateSettings({ application: { voiceProfileId: 'pf_dora' } });
    await this.prisma.voiceProfile.delete({ where: { id } });
    const dir = resolve(process.env.VOICE_PACKS_DIR ?? '/voices');
    if (profile.assetPath && resolve(profile.assetPath).startsWith(`${dir}${sep}`)) await unlink(profile.assetPath).catch(() => undefined);
    return { deleted: true };
  }

  async saveTrainingRecording(category: string, file: Express.Multer.File, durationSeconds?: string | number) {
    if (category !== 'positive' && category !== 'negative' && category !== 'background') {
      throw new BadRequestException('category must be positive, negative, or background');
    }
    if (!file?.buffer?.length || file.buffer.length > 25_000_000) throw new BadRequestException('Recording must be 1 to 25 MB');
    const name = file.originalname.toLowerCase();
    const wav = name.endsWith('.wav') && file.buffer.toString('ascii', 0, 4) === 'RIFF' && file.buffer.toString('ascii', 8, 12) === 'WAVE';
    const webm = name.endsWith('.webm') && file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!wav && !webm) throw new BadRequestException('Recording must be WAV or WebM audio');
    const duration = durationSeconds === undefined || durationSeconds === '' ? undefined : Number(durationSeconds);
    if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > 86_400)) {
      throw new BadRequestException('durationSeconds must be between 0 and 86400');
    }
    const root = resolve(process.env.WAKE_TRAINING_DATA_DIR ?? join(process.cwd(), 'tools/wakeword-training/data'));
    const dir = category === 'background' ? join(root, 'background') : join(root, 'recordings', category);
    await mkdir(dir, { recursive: true });
    const fileName = `recording-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}.${wav ? 'wav' : 'webm'}`;
    const audioPath = join(dir, fileName);
    await writeFile(audioPath, file.buffer, { flag: 'wx' });
    try {
      await writeFile(join(dir, fileName.replace(/\.(?:wav|webm)$/u, '.json')), JSON.stringify({
        source: 'browser_recording', category, recordedAt: new Date().toISOString(), bytes: file.buffer.length,
        ...(duration !== undefined ? { durationSeconds: duration } : {}),
      }), { flag: 'wx' });
    } catch (error) {
      await unlink(audioPath).catch(() => undefined);
      throw error;
    }
    return { saved: true, category, fileName, bytes: file.buffer.length, durationSeconds: duration ?? null };
  }

  async trainingRecordingStats() {
    const root = resolve(process.env.WAKE_TRAINING_DATA_DIR ?? join(process.cwd(), 'tools/wakeword-training/data'));
    const count = async (dir: string, background = false): Promise<number> => {
      try {
        const files = await readdir(dir, { withFileTypes: true });
        const nested = await Promise.all(files.filter((file) => file.isDirectory()).map((file) => count(join(dir, file.name), background)));
        const here = files.filter((file) => file.isFile() && /\.(wav|webm)$/iu.test(file.name) && (!background || !file.name.startsWith('synthetic_'))).length;
        return here + nested.reduce((total, value) => total + value, 0);
      } catch { return 0; }
    };
    const [positive, negative, background] = await Promise.all([
      count(join(root, 'recordings', 'positive')),
      count(join(root, 'recordings', 'negative')),
      count(join(root, 'background'), true),
    ]);
    const wavDuration = async (path: string): Promise<number> => {
      const file = await open(path, 'r');
      try {
        const header = Buffer.alloc(44);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (bytesRead < 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return 0;
        const byteRate = header.readUInt32LE(28);
        const dataBytes = header.readUInt32LE(40);
        return byteRate > 0 ? dataBytes / byteRate : 0;
      } finally {
        await file.close();
      }
    };
    const durationIn = async (dir: string): Promise<number> => {
      try {
        const files = await readdir(dir, { withFileTypes: true });
        const nested = await Promise.all(files.filter((file) => file.isDirectory()).map((file) => durationIn(join(dir, file.name))));
        let here = 0;
        for (const file of files) {
          if (file.isFile() && /^background-.*\.wav$/iu.test(file.name)) {
            try { here += await wavDuration(join(dir, file.name)); }
            catch { /* An invalid WAV contributes no duration. */ }
            continue;
          }
          if (!file.isFile() || !/^recording-.*\.json$/iu.test(file.name)) continue;
          try {
            const metadata = JSON.parse(await readFile(join(dir, file.name), 'utf8')) as { source?: unknown; durationSeconds?: unknown };
            if (metadata.source === 'browser_recording' && typeof metadata.durationSeconds === 'number' && Number.isFinite(metadata.durationSeconds)) {
              here += Math.max(0, metadata.durationSeconds);
            }
          } catch { /* A malformed sidecar does not hide valid recordings. */ }
        }
        return here + nested.reduce((total, value) => total + value, 0);
      } catch { return 0; }
    };
    const backgroundDurationSeconds = await durationIn(join(root, 'background'));
    return { positive, negative, background, backgroundDurationSeconds };
  }
}
