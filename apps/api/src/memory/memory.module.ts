import { Global, Module } from '@nestjs/common';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryWorker } from './memory-worker.service';

@Global()
@Module({ controllers: [MemoryController], providers: [MemoryService, MemoryWorker], exports: [MemoryService] })
export class MemoryModule {}
