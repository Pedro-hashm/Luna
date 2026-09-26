import "dotenv/config";
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { VoiceGateway } from './voice/voice.gateway';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.get(VoiceGateway).attach(app.getHttpServer());
  await app.listen(process.env.PORT ?? 8000, process.env.HOST ?? "0.0.0.0");
}
bootstrap();
