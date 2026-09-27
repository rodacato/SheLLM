'use strict';

const { invalidRequest, unsupportedParameter } = require('../../errors');

// Nothing downstream reads tools: silently dropping them hands the caller prose where its code
// waits for a tool call. An empty list declares nothing, so it passes.
function refuseFunctionCalling(body, { toolFields, choiceFields, forcesCall }) {
  for (const field of toolFields) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) return invalidRequest(`Field "${field}" must be an array`);
    if (value.length > 0) {
      return unsupportedParameter(field, `Function calling is not supported yet: SheLLM answers with text only, so a request carrying "${field}" is refused rather than answered in prose. Send it without "${field}".`);
    }
  }
  for (const field of choiceFields) {
    if (forcesCall(body[field])) {
      return unsupportedParameter(field, `Field "${field}" asks for a tool call, and function calling is not supported yet: SheLLM answers with text only.`);
    }
  }
  return null;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function refuseOpenAITools(body) {
  return refuseFunctionCalling(body, {
    toolFields: ['tools', 'functions'],
    choiceFields: ['tool_choice', 'function_call'],
    forcesCall: (choice) => choice === 'required' || isPlainObject(choice),
  });
}

function refuseAnthropicTools(body) {
  return refuseFunctionCalling(body, {
    toolFields: ['tools'],
    choiceFields: ['tool_choice'],
    forcesCall: (choice) => isPlainObject(choice) && (choice.type === 'any' || choice.type === 'tool'),
  });
}

module.exports = { refuseOpenAITools, refuseAnthropicTools };
