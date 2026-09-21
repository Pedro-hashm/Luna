import { BadRequestException } from '@nestjs/common';

export class ToolArgumentException extends BadRequestException {
  readonly argument: string;

  constructor(argument: string, message: string) {
    super({
      statusCode: 400,
      errorType: 'INVALID_ARGUMENT',
      argument,
      message,
    });
    this.argument = argument;
  }
}

export class ToolRuntimeContextException extends BadRequestException {
  constructor(message: string) {
    super({
      statusCode: 400,
      errorType: 'RUNTIME_CONTEXT',
      message,
    });
  }
}
