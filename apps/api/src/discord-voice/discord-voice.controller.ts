import { Body, Controller, Get, Header, Headers, HttpCode, Patch, Post, StreamableFile } from '@nestjs/common';
import { DiscordVoiceService } from './discord-voice.service';

@Controller('discord-voice')
export class DiscordVoiceController {
  constructor(private readonly discordVoice: DiscordVoiceService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  settings() {
    return this.discordVoice.getSettings();
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  updateSettings(@Body() input: unknown) {
    return this.discordVoice.updateSettings(input);
  }

  @Get('worker')
  @Header('Cache-Control', 'no-store')
  worker(@Headers('authorization') authorization?: string) {
    this.discordVoice.authorizeWorker(authorization);
    return this.discordVoice.configuration();
  }

  @Post('worker/status')
  @HttpCode(204)
  updateStatus(@Headers('authorization') authorization: string | undefined, @Body() input: unknown) {
    this.discordVoice.authorizeWorker(authorization);
    this.discordVoice.updateStatus(input);
  }

  @Post('worker/turn')
  @Header('Cache-Control', 'no-store')
  async workerTurn(@Headers('authorization') authorization: string | undefined, @Body() input: unknown) {
    this.discordVoice.authorizeWorker(authorization);
    const { audio, mimeType } = await this.discordVoice.processWorkerTurn(input);
    return new StreamableFile(audio, { type: mimeType, disposition: 'inline' });
  }
}
