import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { object } from './memory.types';
import { MemoryWorker } from './memory-worker.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService, private readonly worker: MemoryWorker) {}

  @Get()
  list() { return this.memory.list(); }

  @Patch('settings')
  settings(@Body() input: unknown) { return this.memory.configure(input); }

  @Post('review')
  review() { return this.worker.run(true); }

  @Post('items')
  create(@Body() input: unknown) { return this.memory.save(input); }

  @Get('items/:id')
  item(@Param('id', ParseUUIDPipe) id: string) { return this.memory.get(id); }

  @Patch('items/:id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown) { return this.memory.save(input, id); }

  @Delete('items/:id')
  forget(@Param('id', ParseUUIDPipe) id: string, @Query('version') version: string) {
    return this.memory.forget(id, Number(version));
  }

  @Post('suggestions/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown) {
    return this.memory.approve(id, object(input ?? {}));
  }

  @Delete('suggestions/:id')
  dismiss(@Param('id', ParseUUIDPipe) id: string) { return this.memory.dismiss(id); }
}
