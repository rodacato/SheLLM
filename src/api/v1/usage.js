'use strict';

// Providers report usage in Anthropic's shape: input_tokens is the uncached remainder, cache
// reads and writes sit beside it, and output_tokens already includes any reasoning.

// OpenAI counts every input token in prompt_tokens and breaks the cached ones out. Passing
// input_tokens through alone reported a 10k-token prompt served from cache as 10.
function openAIUsage(usage) {
  if (!usage) return { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  const cached = usage.cache_read_input_tokens || 0;
  const prompt = usage.input_tokens + (usage.cache_creation_input_tokens || 0) + cached;
  const openai = {
    prompt_tokens: prompt,
    completion_tokens: usage.output_tokens,
    total_tokens: prompt + usage.output_tokens,
    prompt_tokens_details: { cached_tokens: cached },
  };
  if (usage.reasoning_tokens != null) openai.completion_tokens_details = { reasoning_tokens: usage.reasoning_tokens };
  return openai;
}

function anthropicCacheUsage(usage) {
  if (!usage) return {};
  const cache = {};
  if (usage.cache_creation_input_tokens != null) cache.cache_creation_input_tokens = usage.cache_creation_input_tokens;
  if (usage.cache_read_input_tokens != null) cache.cache_read_input_tokens = usage.cache_read_input_tokens;
  return cache;
}

module.exports = { openAIUsage, anthropicCacheUsage };
