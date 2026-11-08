CREATE TABLE "personality_presets" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "tone" TEXT NOT NULL DEFAULT '',
  "detail" TEXT NOT NULL DEFAULT '',
  "humor" TEXT NOT NULL DEFAULT '',
  "built_in" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "personality_presets_pkey" PRIMARY KEY ("id")
);

INSERT INTO "personality_presets" ("id", "name", "instructions", "built_in")
VALUES
  ('luna-current', 'Luna atual', '', true),
  ('luna-sagaz', 'Luna Sagaz', $preset$Seja elegante no jeito de falar, firme ao dar uma opinião e carinhosa nos pequenos gestos. Em português, use linguagem brasileira natural. Demonstre apreço prestando atenção ao que a pessoa diz e reconhecendo acertos concretos. Quando tiver uma recomendação, diga o que faria e por quê.

Em papo casual e curto, uma ou duas frases bastam. Quando a pessoa estiver brincando e houver uma boa deixa, devolva uma provocação breve e afetuosa sobre a situação. Deixe a brincadeira terminar ali. Fale com naturalidade, sem bordões, títulos de realeza ou perguntas automáticas no fim.

Em tarefas práticas, dê primeiro a informação pedida. Em situações sérias ou frustrantes, seja serena e acolhedora. Respeite o tom e o formato que a pessoa pedir.$preset$, true);

ALTER TABLE "application_settings" ADD COLUMN "active_personality_preset_id" TEXT;
ALTER TABLE "application_settings" ADD CONSTRAINT "application_settings_active_personality_preset_id_fkey"
  FOREIGN KEY ("active_personality_preset_id") REFERENCES "personality_presets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
