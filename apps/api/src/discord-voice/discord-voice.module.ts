import { Module } from '@nestjs/common';
import { DiscordVoiceController } from './discord-voice.controller';
import { DiscordVoiceService } from './discord-voice.service';

@Module({
  controllers: [DiscordVoiceController],
  providers: [DiscordVoiceService],
})
export class DiscordVoiceModule {}
