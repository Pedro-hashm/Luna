import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { LunaService } from './luna.service';
import { PersonalityService, readPersonalityPreview } from './personality.service';

@Controller('personality')
export class PersonalityController {
  constructor(
    private readonly personalities: PersonalityService,
    private readonly luna: LunaService,
  ) {}

  @Get()
  list() {
    return this.personalities.list();
  }

  @Post()
  create(@Body() input: unknown) {
    return this.personalities.create(input);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: unknown) {
    return this.personalities.update(id, input);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.personalities.activate(id);
  }

  @Post('preview')
  preview(@Body() input: unknown) {
    const { input: message, draft } = readPersonalityPreview(input);
    return this.luna.previewPersonality(message, draft);
  }
}
