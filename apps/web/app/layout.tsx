import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChatSpeechProvider } from "@/components/chat/chat-speech-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luna",
  description: "Sua assistente pessoal.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><ChatSpeechProvider>{children}</ChatSpeechProvider></body>
    </html>
  );
}
