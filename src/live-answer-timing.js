'use strict';

const QUESTION_LEAD_RE = /^(?:why|how|what|when|where|which|who|whose|tell me|describe|walk me through|give me|can you|could you|would you|have you|do you|did you|are you|were you|if you|imagine you)\b/i;
const SHORT_FOLLOWUP_RE = /^(?:tell me more|can you elaborate|could you elaborate|elaborate|go on|what happened next|and then|why|why not|how so|what else|anything else|what about you)\s*[?.!]*$/i;
const TRAILING_INCOMPLETE_RE = /\b(?:a|an|the|and|or|but|because|with|without|about|for|from|into|of|on|to|at|by|as|than|that|this|these|those|you|your|our|their|my|his|her|its)\s*[?.!]*$/i;
const TRAILING_SCENARIO_RE = /^(?:tell me|describe|give me|share|walk me through).*\b(?:time|example|situation)\b.*\b(?:you (?:had|were|did|have|would|could|needed)|you had to)\s*[?.!]*$/i;

function clampDelay(value) {
  return Math.max(250, Math.min(900, Number(value) || 700));
}

function analyzeQuestionCompleteness(question) {
  const text = String(question || '').trim();
  if (!text) {
    return {
      complete: false,
      veryComplete: false,
      shortFollowup: false,
      trailingIncomplete: false,
      hasQuestionLead: false,
      hasQuestionMark: false
    };
  }

  const hasQuestionMark = /\?\s*$/.test(text);
  const hasQuestionLead = QUESTION_LEAD_RE.test(text);
  const shortFollowup = SHORT_FOLLOWUP_RE.test(text);
  const trailingIncomplete = !shortFollowup && (TRAILING_INCOMPLETE_RE.test(text) || TRAILING_SCENARIO_RE.test(text));
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const complete = !trailingIncomplete && (shortFollowup || hasQuestionMark || (hasQuestionLead && wordCount >= 4));
  const veryComplete = complete && hasQuestionMark && (hasQuestionLead || wordCount >= 5);

  return {
    complete,
    veryComplete,
    shortFollowup,
    trailingIncomplete,
    hasQuestionLead,
    hasQuestionMark
  };
}

function liveAnswerDelayMs({
  question,
  source = 'final',
  streamingMode = false,
  configuredDelayMs = 700
} = {}) {
  const configured = clampDelay(configuredDelayMs);
  const shape = analyzeQuestionCompleteness(question);

  if (source === 'interim') {
    if (shape.trailingIncomplete) return 900;
    if (shape.shortFollowup) return 420;
    if (shape.veryComplete) return 300;
    if (shape.complete) return 520;
    return 760;
  }

  if (streamingMode) {
    if (shape.trailingIncomplete) return 620;
    if (shape.veryComplete) return 220;
    if (shape.shortFollowup || shape.complete) return 300;
    return 420;
  }

  if (shape.trailingIncomplete) return configured;
  if (shape.veryComplete) return Math.min(configured, 460);
  if (shape.shortFollowup || shape.complete) return Math.min(configured, 620);
  return configured;
}

module.exports = { analyzeQuestionCompleteness, liveAnswerDelayMs };
