export class LLMError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'LLMError';
  }
}

export const handleLLMError = (error: any): LLMError => {
  if (error instanceof LLMError) return error;

  return new LLMError(
    error.message || 'LLMサービスでエラーが発生しました。',
    error.code
  );
};
