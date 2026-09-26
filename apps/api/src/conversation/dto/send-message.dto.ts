export class SendMessageDto {
    content!: string;
    inputMode?: 'text' | 'voice';
    outputMode?: 'text' | 'voice';
}
