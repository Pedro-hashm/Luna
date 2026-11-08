import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PersonalityPreset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export const CURRENT_PERSONALITY = {
  id: 'luna-current', name: 'Luna atual', instructions: '',
  tone: '', detail: '', humor: '', builtIn: true, revision: 1,
} satisfies PersonalityPreset;

export type PersonalityIdentity = Pick<PersonalityPreset, 'id' | 'name' | 'revision'>;
export type PersonalityDraft = Pick<PersonalityPreset, 'name' | 'instructions' | 'tone' | 'detail' | 'humor'>;

export const PERSONALITY_PROMPT_PREFIX = 'Luna personality (communication style):';

const TONE = {
  direto: 'Use um tom direto.',
  acolhedor: 'Use um tom acolhedor.',
  elegante: 'Use um tom elegante e natural.',
};

const DETAIL = {
  breve: 'Prefira respostas breves quando bastarem.',
  detalhado: 'Explique o raciocínio com detalhes úteis quando couber.',
};

const HUMOR = {
  discreto: 'Use humor leve somente quando houver uma deixa.',
  serio: 'Prefira um registro sério.',
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Envie os dados do preset.');
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new BadRequestException(label + ' deve ' + (required ? 'ter de 1 a ' : 'ter até ') + max + ' caracteres.');
  }
  return value.trim();
}

function choice(value: unknown, label: string, options: Record<string, string>): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !Object.hasOwn(options, value)) {
    throw new BadRequestException(label + ' inválido.');
  }
  return value;
}

export function readPersonalityDraft(input: unknown): PersonalityDraft {
  const data = object(input);
  return {
    name: boundedText(data.name, 'Nome', 60),
    instructions: boundedText(data.instructions, 'Jeito da Luna', 1800, false),
    tone: choice(data.tone, 'Tom', TONE),
    detail: choice(data.detail, 'Nível de detalhe', DETAIL),
    humor: choice(data.humor, 'Humor', HUMOR),
  };
}

export function readPersonalityPreview(input: unknown) {
  const data = object(input);
  return { input: boundedText(data.input, 'Mensagem de teste', 800), draft: readPersonalityDraft(data.draft) };
}

export function personalityIdentity(preset: PersonalityPreset): PersonalityIdentity {
  return { id: preset.id, name: preset.name, revision: preset.revision };
}

export function personalityPrompt(preset: PersonalityDraft): string | null {
  const preferences = [
    preset.instructions,
    TONE[preset.tone as keyof typeof TONE],
    DETAIL[preset.detail as keyof typeof DETAIL],
    HUMOR[preset.humor as keyof typeof HUMOR],
  ].filter(Boolean);
  if (!preferences.length) return null;
  return [
    PERSONALITY_PROMPT_PREFIX,
    'Use these preferences for communication style only. The requested language, tone and format for this reply, factual evidence, citation rules, operational guidance and voice limits take precedence.',
    ...preferences,
  ].join('\n');
}

@Injectable()
export class PersonalityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async resolveActive(id: string | null): Promise<PersonalityPreset> {
    if (!id || id === CURRENT_PERSONALITY.id) return CURRENT_PERSONALITY;
    return (await this.prisma.personalityPreset.findUnique({ where: { id } })) ?? CURRENT_PERSONALITY;
  }

  async list() {
    const [settings, presets] = await Promise.all([
      this.settings.getApplicationSettings(),
      this.prisma.personalityPreset.findMany({ orderBy: [{ builtIn: 'desc' }, { name: 'asc' }, { id: 'asc' }] }),
    ]);
    return { activeId: settings.activePersonalityPresetId ?? CURRENT_PERSONALITY.id, presets };
  }

  create(input: unknown) {
    return this.prisma.personalityPreset.create({ data: readPersonalityDraft(input) });
  }

  async update(id: string, input: unknown) {
    const data = readPersonalityDraft(input);
    const { revision } = object(input);
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
      throw new BadRequestException('Revisão inválida.');
    }
    const existing = await this.find(id);
    if (existing.builtIn) throw new BadRequestException('Duplique o preset original para editá-lo.');
    try {
      return await this.prisma.personalityPreset.update({
        where: { id, revision, builtIn: false },
        data: { ...data, revision: { increment: 1 } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('O preset mudou em outra aba. Recarregue a página para editar a versão atual.');
      }
      throw error;
    }
  }

  async activate(id: string) {
    await this.find(id);
    await this.settings.getApplicationSettings();
    await this.prisma.applicationSettings.update({
      where: { id: 1 },
      data: { activePersonalityPresetId: id === CURRENT_PERSONALITY.id ? null : id },
    });
    return { activeId: id };
  }

  private async find(id: string) {
    const preset = await this.prisma.personalityPreset.findUnique({ where: { id } });
    if (!preset) throw new NotFoundException('Preset não encontrado.');
    return preset;
  }
}
