import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardedHttpClient } from '../research/providers/extraction/guarded-http.client';
import { SettingsModule } from '../settings/settings.module';
import { VoiceController } from './voice.controller';
import { VoiceGateway } from './voice.gateway';
import { F5TtsProvider, FasterQwenTtsProvider, FishAudioTtsProvider, KokoroTtsProvider, OpenWakeWordProvider, QwenTtsProvider, SpeachesSttProvider } from './voice.providers';
import { VoiceService } from './voice.service';

@Module({
  imports: [PrismaModule, SettingsModule, ConversationModule],
  controllers: [VoiceController],
  providers: [VoiceService, VoiceGateway, KokoroTtsProvider, QwenTtsProvider, FasterQwenTtsProvider, F5TtsProvider, FishAudioTtsProvider, SpeachesSttProvider, OpenWakeWordProvider, GuardedHttpClient],
  exports: [VoiceGateway, VoiceService],
})
export class VoiceModule {}
