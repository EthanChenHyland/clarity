'use strict';

const QUESTION_START = /^(who|what|when|where|why|how|which|whose|can|could|would|will|do|did|does|are|is|was|were|have|has|had|should|tell me|walk me through|describe|explain|give me|share an example|talk me through|any questions)/i;

function isLikelyInterviewQuestion(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length < 8) return false;
  if (value.endsWith('?')) return true;
  return QUESTION_START.test(value);
}

function collectRecentInterviewerQuestion(turns, options = {}) {
  const maxTurns = options.maxTurns || 3;
  const maxGapMs = options.maxGapMs || 12000;
  const recent = [];
  let lastTs = null;

  for (let i = (turns || []).length - 1; i >= 0 && recent.length < maxTurns; i--) {
    const turn = turns[i];
    if (!turn || turn.channel !== 'them') break;
    const ts = Number(turn.ts) || 0;
    if (lastTs !== null && lastTs - ts > maxGapMs) break;
    recent.unshift(String(turn.text || '').trim());
    lastTs = ts;
  }

  return recent.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeTranscriptText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyTranscriptEcho(candidateText, remoteText) {
  const candidate = normalizeTranscriptText(candidateText);
  const remote = normalizeTranscriptText(remoteText);
  if (candidate.length < 12 || remote.length < 12) return false;

  // Preserve meaning-changing words and word order. Bag-of-words similarity
  // incorrectly discarded replies containing negation or different pronouns.
  if (candidate === remote) return true;
  const trailingFillers = /^(?:you|yo|um|uh|hmm|ah)(?: (?:you|yo|um|uh|hmm|ah))*$/;
  if (candidate.startsWith(remote + ' ')) return trailingFillers.test(candidate.slice(remote.length + 1));
  return false;
}

module.exports = {
  isLikelyInterviewQuestion,
  collectRecentInterviewerQuestion,
  isLikelyTranscriptEcho
};
