'use strict';

const { UNKNOWN_MODEL } = require('../../sdk/shellm-server');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The answer's text, from a buffered body or a stream, in either format.
function answerText(response) {
  if (response.events) {
    return response.events.map(({ data }) => data?.delta?.text ?? data?.choices?.[0]?.delta?.content ?? '').join('');
  }
  const body = response.body || {};
  return body.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? body.choices?.[0]?.message?.content ?? '';
}

function answerIsJsonObject(response) {
  const text = answerText(response);
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? null : `the answer is JSON but not an object: ${text.slice(0, 80)}`;
  } catch {
    return `the answer is not JSON: ${text.slice(0, 80)}`;
  }
}

module.exports = { PNG_1PX, UNKNOWN_MODEL, answerText, answerIsJsonObject };
