import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, ServiceUnavailableException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { VoiceService } from './voice.service';
import { VoiceGateway } from './voice.gateway';
import { OpenWakeWordProvider } from './voice.providers';
import type { VoiceMode } from './voice.types';

@Controller('voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService, private readonly gateway: VoiceGateway, private readonly wake: OpenWakeWordProvider) {}

  @Get('wake/status')
  async wakeStatus() {
    try { return await this.wake.status(); }
    catch (error) { throw new ServiceUnavailableException(error instanceof Error ? error.message : 'Wake service unavailable'); }
  }

  @Post('sessions')
  startSession(@Body() input: { conversationId?: string; mode?: VoiceMode }) {
    return this.voice.startSession(input ?? {});
  }

  @Get('sessions')
  listSessions(@Query('conversationId') conversationId: string) {
    return this.voice.listSessions(conversationId);
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string) {
    return this.voice.getSession(id);
  }

  @Get('sessions/:id/events')
  sessionEvents(@Param('id') id: string) {
    return this.voice.sessionEvents(id);
  }

  @Patch('sessions/:id/mode')
  changeMode(@Param('id') id: string, @Body() input?: { mode: VoiceMode }) {
    return this.voice.changeMode(id, input?.mode as VoiceMode);
  }

  @Post('sessions/:id/end')
  async endSession(@Param('id') id: string) {
    const ended = await this.voice.endSession(id);
    this.gateway.closeSession(id);
    return ended;
  }

  @Get('profiles')
  listProfiles() {
    return this.voice.listProfiles();
  }

  @Get('training/recordings/stats')
  trainingRecordingStats() {
    return this.voice.trainingRecordingStats();
  }

  @Post('training/recordings')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25_000_000 } }))
  saveTrainingRecording(@Query('category') category: string, @UploadedFile() file: Express.Multer.File, @Body() body: { durationSeconds?: string }) {
    return this.voice.saveTrainingRecording(category, file, body?.durationSeconds);
  }

  @Post('profiles/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10_000_000 } }))
  importLocalProfile(@UploadedFile() file: Express.Multer.File, @Body() body: { name: string; license?: string; voiceId?: string }) {
    if (!file) return this.voice.importLocalProfile(body, '', Buffer.alloc(0));
    return this.voice.importLocalProfile(body, file.originalname, file.buffer);
  }

  @Post('profiles/import')
  importProfile(@Body() input: { name: string; url: string; license?: string; voiceId?: string }) {
    return this.voice.importProfile(input);
  }

  @Post('profiles/:id/select')
  selectProfile(@Param('id') id: string) {
    return this.voice.selectProfile(id);
  }

  @Get('profiles/:id/preview')
  async preview(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const generated = await this.voice.preview(id);
    response.setHeader('content-type', generated.mimeType);
    response.setHeader('cache-control', 'private, max-age=300');
    response.send(generated.audio);
  }

  @Delete('profiles/:id')
  deleteProfile(@Param('id') id: string) {
    return this.voice.deleteProfile(id);
  }
}
