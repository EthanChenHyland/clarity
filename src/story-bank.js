'use strict';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could',
  'did', 'do', 'for', 'from', 'give', 'had', 'has', 'have', 'how', 'i', 'in',
  'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'them',
  'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why',
  'with', 'would', 'you', 'your'
]);

const INTENT_TERMS = {
  leadership: ['lead', 'led', 'leader', 'leadership', 'initiative', 'influence', 'ownership'],
  conflict: ['conflict', 'disagree', 'disagreement', 'difficult', 'feedback', 'tension'],
  failure: ['fail', 'failed', 'failure', 'mistake', 'setback', 'wrong'],
  pressure: ['deadline', 'pressure', 'urgent', 'outage', 'incident', 'crisis', 'production'],
  achievement: ['achievement', 'accomplish', 'success', 'proud', 'impact', 'result'],
  learning: ['learn', 'learned', 'learning', 'new', 'quickly', 'adapt', 'adapted'],
  teamwork: ['team', 'teammate', 'collaborate', 'collaboration', 'partner', 'cross-functional'],
  technical: ['project', 'build', 'built', 'system', 'technical', 'code', 'model', 'data', 'software']
};

function normalizeText(text) {
  return String(text || '').replace(/\r/g, '').trim();
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+.#-]*/g)?.filter(token => token.length > 2 && !STOP_WORDS.has(token)) || [];
}

function splitGroundedChunks(text, { maxChars = 700 } = {}) {
  const clean = normalizeText(text);
  if (!clean) return [];

  let rawChunks = clean.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean);
  if (rawChunks.length === 1 && clean.includes('\n')) {
    rawChunks = clean.split(/\n+/).map(part => part.trim()).filter(Boolean);
  }

  const chunks = [];
  for (const raw of rawChunks) {
    if (raw.length <= maxChars) {
      if (raw.length >= 20) chunks.push(raw);
      continue;
    }
    const sentences = raw.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [raw];
    let current = '';
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
      if (next.length > maxChars && current) {
        chunks.push(current);
        current = sentence.trim();
      } else {
        current = next;
      }
    }
    if (current.length >= 20) chunks.push(current);
  }
  return chunks;
}

function detectIntents(text) {
  const tokens = new Set(tokenize(text));
  const lowered = normalizeText(text).toLowerCase();
  const intents = [];
  for (const [intent, terms] of Object.entries(INTENT_TERMS)) {
    if (terms.some(term => tokens.has(term) || lowered.includes(term))) intents.push(intent);
  }
  return intents;
}

function scoreCandidate(question, candidate) {
  const questionTokens = new Set(tokenize(question));
  const candidateTokens = new Set(tokenize(candidate.text));
  let score = candidate.source === 'star' ? 4 : 0;

  for (const token of questionTokens) {
    if (candidateTokens.has(token)) score += 2;
  }

  const questionIntents = detectIntents(question);
  const candidateIntents = new Set(detectIntents(candidate.text));
  for (const intent of questionIntents) {
    if (candidateIntents.has(intent)) score += 5;
  }

  return score;
}

function buildStoryBank({ question = '', resumeText = '', starStories = '', limit = 3 } = {}) {
  const sourceRank = { star: 0, resume: 1 };
  const candidates = [
    ...splitGroundedChunks(starStories).map((text, index) => ({ source: 'star', index, text })),
    ...splitGroundedChunks(resumeText, { maxChars: 500 }).map((text, index) => ({ source: 'resume', index, text }))
  ];

  return candidates
    .map(candidate => ({ ...candidate, score: scoreCandidate(question, candidate) }))
    .sort((a, b) => b.score - a.score || sourceRank[a.source] - sourceRank[b.source] || a.index - b.index)
    .slice(0, Math.max(1, limit));
}

function formatStoryBank(stories) {
  if (!Array.isArray(stories) || !stories.length) return '';
  return stories.map((story, index) => {
    const label = story.source === 'star' ? 'Verified STAR story' : 'Resume evidence';
    return `${index + 1}. ${label}: ${story.text}`;
  }).join('\n');
}

module.exports = { buildStoryBank, detectIntents, formatStoryBank, splitGroundedChunks };
