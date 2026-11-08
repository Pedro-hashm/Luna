import {
  BadRequestException, ConflictException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const statusStates = ['offline', 'missing_token', 'disabled', 'connecting', 'ready', 'in_channel', 'error'] as const;
const statusTtlMs = 30_000;
const configurationFields = { enabled: true, guildId: true, channelId: true } as const;
const maxSnowflake = (1n << 64n) - 1n;

type State = (typeof statusStates)[number];
type Configuration = { enabled: boolean; guildId: string | null; channelId: string | null };
type Destination = { id: string; name: string; channels: Array<{ id: string; name: string }> };
type WorkerStatus = { state: State; updatedAt: number; destinations: Destination[] };

const initialConfiguration: Configuration = { enabled: false, guildId: null, channelId: null };

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key))) {
    throw new BadRequestException('Dados do Discord inválidos.');
  }
  return value as Record<string, unknown>;
}

function snowflake(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/u.test(value) || BigInt(value) > maxSnowflake) {
    throw new BadRequestException('Informe um ID válido do Discord.');
  }
  return value;
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new BadRequestException('Nome de servidor ou canal inválido.');
  }
  return value;
}

function destinations(value: unknown): Destination[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new BadRequestException('Lista de servidores inválida.');
  }
  return value.map(guild => {
    const item = object(guild, ['id', 'name', 'channels']);
    if (!Array.isArray(item.channels) || item.channels.length > 500) {
      throw new BadRequestException('Lista de canais inválida.');
    }
    return {
      id: snowflake(item.id), name: name(item.name),
      channels: item.channels.map(value => {
        const channel = object(value, ['id', 'name']);
        return { id: snowflake(channel.id), name: name(channel.name) };
      }),
    };
  });
}

@Injectable()
export class DiscordVoiceService {
  private workerStatus?: WorkerStatus;

  constructor(private readonly prisma: PrismaService) {}

  async configuration(): Promise<Configuration> {
    return await this.prisma.discordVoiceSettings.findUnique({
      where: { id: 1 }, select: configurationFields,
    }) ?? initialConfiguration;
  }

  async getSettings() {
    return this.settingsView(await this.configuration());
  }

  async updateSettings(value: unknown) {
    const patch = object(value, ['enabled', 'guildId', 'channelId']);
    if ('enabled' in patch && typeof patch.enabled !== 'boolean') {
      throw new BadRequestException('Informe se a integração está ativada.');
    }
    const guild = patch.guildId === undefined || patch.guildId === null ? patch.guildId : snowflake(patch.guildId);
    const channel = patch.channelId === undefined || patch.channelId === null ? patch.channelId : snowflake(patch.channelId);

    const configuration = await this.prisma.$transaction(async tx => {
      const current = await tx.discordVoiceSettings.findUnique({ where: { id: 1 }, select: configurationFields }) ??
        initialConfiguration;
      const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled;
      const guildId = guild === undefined ? current.guildId : guild;
      const channelId = channel === undefined ? (guildId === current.guildId ? current.channelId : null) : channel;
      if ((!guildId && channelId) || (enabled && (!guildId || !channelId))) {
        throw new BadRequestException('Selecione um servidor e um canal de voz para ativar o Discord.');
      }
      const data = { enabled, guildId, channelId };
      return tx.discordVoiceSettings.upsert({
        where: { id: 1 }, create: { id: 1, ...data }, update: data, select: configurationFields,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new ConflictException('A configuração mudou. Atualize a tela e tente novamente.');
      }
      throw error;
    });
    return this.settingsView(configuration);
  }

  authorizeWorker(authorization: string | undefined) {
    const secret = process.env.DISCORD_VOICE_WORKER_SECRET;
    if (!secret || !authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }
    const actual = Buffer.from(authorization.slice('Bearer '.length));
    const expected = Buffer.from(secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException();
    }
  }

  updateStatus(value: unknown) {
    const report = object(value, ['state', 'destinations']);
    if (!statusStates.includes(report.state as State)) {
      throw new BadRequestException('Estado do serviço Discord inválido.');
    }
    const state = report.state as State;
    const now = Date.now();
    const previous = this.currentWorkerStatus(now);
    const visibleDestinations = report.destinations === undefined ? previous?.destinations ?? [] : destinations(report.destinations);
    this.workerStatus = { state, updatedAt: now, destinations: visibleDestinations };
  }

  private currentWorkerStatus(now: number) {
    if (this.workerStatus && now - this.workerStatus.updatedAt < statusTtlMs) {
      return this.workerStatus;
    }
    this.workerStatus = undefined;
    return undefined;
  }

  private settingsView(configuration: Configuration) {
    const worker = this.currentWorkerStatus(Date.now());
    return {
      ...configuration,
      status: {
        state: worker?.state ?? 'offline',
        updatedAt: worker ? new Date(worker.updatedAt).toISOString() : null,
      },
      destinations: worker?.destinations ?? [],
    };
  }
}
