import { Module } from '@nestjs/common';
import { DiscordVoiceController } from './discord-voice.controller';
import { DiscordVoiceService } from './discord-voice.service';
import { ConversationModule } from '../conversation/conversation.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [ConversationModule, VoiceModule],
  controllers: [DiscordVoiceController],
  providers: [DiscordVoiceService],
})
export class DiscordVoiceModule {}
