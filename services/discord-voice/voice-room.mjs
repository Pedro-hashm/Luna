export class VoiceRoom {
  constructor({ providers, playReply, log = () => {} }) {
    this.providers = providers;
    this.playReply = playReply;
    this.log = log;
    this.turn = undefined;
  }

  askText(question) {
    if (this.turn) return undefined;
    const turn = { userId: question.userId, controller: new AbortController() };
    this.turn = turn;
    return this.respond(turn, question);
  }

  async respond(turn, question) {
    const { signal } = turn.controller;
    try {
      this.log('chat_text_requested');
      const audio = await this.providers.answer(question.query, question, signal);
      signal.throwIfAborted();
      await this.playReply(audio, signal);
      signal.throwIfAborted();
      this.log('turn_complete');
      return 'complete';
    } catch {
      if (signal.aborted) return 'cancelled';
      this.log('turn_error');
      return 'error';
    } finally {
      if (this.turn === turn) this.turn = undefined;
    }
  }

  cancel(userId) {
    const turn = this.turn;
    if (!turn || (userId !== undefined && turn.userId !== userId)) return;
    this.turn = undefined;
    turn.controller.abort();
  }
}
