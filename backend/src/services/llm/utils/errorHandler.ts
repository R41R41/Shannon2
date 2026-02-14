import { LLMError, getErrorMessage } from '../../../errors/base.js';

// Re-export for backward compatibility
export { LLMError };

export const handleLLMError = (error: unknown): LLMError => {
  if (error instanceof LLMError) return error;

  const originalError = error instanceof Error
    ? error
    : new Error(getErrorMessage(error));

  return new LLMError('unknown', originalError);
};
