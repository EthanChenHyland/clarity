// Simple JSON-file settings store (avoids native modules so `npm install` stays clean).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeBaseUrl } = require('./openai-compatible');
const { DEFAULT_MODEL_ID } = require('./whisper-model-catalog');

const USER_DATA_DIR = app.getPath('userData');
const FILE = path.join(USER_DATA_DIR, 'clarity-data.json');

const CURRENT_ANTHROPIC_FAST = 'claude-haiku-4-5-20251001';
const CURRENT_ANTHROPIC_SMART = 'claude-sonnet-5';
const RETIRED_ANTHROPIC_DEFAULTS = new Set([
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20240620',
  'claude-3-5-sonnet-20241022',
  'claude-3-7-sonnet-20250219'
]);

// Cap on the user's custom response rules. Generous but bounded: anything longer
// should live in a real prompt file, not in a settings field.
const MAX_AI_RULES_CHARS = 2000;

const DEFAULTS = {
  // First-run walkthrough state. Once completed or skipped, this stays true
  // across restarts while every other setting is preserved by deepMerge.
  onboarded: false,
  provider: 'openai',
  sttProvider: 'local',
  localWhisper: {
    modelId: DEFAULT_MODEL_ID,
    language: 'auto',
    threads: 0
  },
  smart: false,
  saveTranscripts: true,
  // When enabled, a finalized interviewer question automatically triggers the
  // same answerThis flow used by manual interview answers. Users can turn this
  // off in Interview Prep; every automatic answer consumes an LLM request.
  liveAnswerSuggestions: true,
  liveAnswerDelayMs: 1200,
  baseUrl: 'https://openrouter.ai/api/v1',
  minimaxRegion: 'global_en',
  apiKeys: { openai: '', anthropic: '', gemini: '', deepgram: '', custom: '', ollama: '', groq: '', minimax: '' , azure: '' },
  azureEndpoint: '',
  // Tab 2: Profile
  resumeText: '',
  jobDescription: '',
  // Tab 3: Interview Prep
  starStories: '',       // 3-5 behavioral STAR stories in plain English
  whyCompany: '',        // Why do you want to work here?
  whyLeaving: '',        // Why are you leaving your current job?
  workStyle: '',         // How you work, decision-making style, values
  // Tab 4: Q&A
  salaryTarget: '',      // e.g. "$150k-$180k base + equity"
  questionsToAsk: '',    // Questions to ask the interviewer
  // Tab 5: Style — custom response rules
  // The user writes how the AI should write: e.g. "no em-dashes", "use bullet
  // points", "casual tone". Applied to every LLM mode EXCEPT LeetCode (kept
  // strict for coding problems).
  aiRules: '',
  // Window position
  windowX: null,
  windowY: null,
  models: {
    openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' },
    anthropic: { fast: CURRENT_ANTHROPIC_FAST, smart: CURRENT_ANTHROPIC_SMART },
    // Kept in sync with CURRENT_GEMINI_DEFAULT in src/llm.js — gemini-2.0-flash
    // (the previous default here) was retired by Google on 2026-03-03 and 404s
    // on every request. gemini-2.5-flash is current and free-tier available.
    gemini: { fast: 'gemini-2.5-flash', smart: 'gemini-2.5-flash' },
    custom: { fast: 'deepseek/deepseek-v4.1-flash', smart: 'openai/gpt-5.6-sol' },
    ollama: { fast: 'llama3.2', smart: 'llama3.3' },
    groq: { fast: 'llama-3.1-8b-instant', smart: 'llama-3.3-70b-versatile' },
    minimax: { fast: 'MiniMax-M2.7', smart: 'MiniMax-M3' },
    azure: { fast: 'gpt-4o-mini', smart: 'gpt-4o' }
  }
};

let data = null;

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      if (!over[k] || typeof over[k] !== 'object' || Array.isArray(over[k])) continue;
      out[k] = deepMerge(base[k], over[k]);
    } else {
      if (k === 'aiRules' && typeof over[k] === 'string') {
        out[k] = over[k].slice(0, MAX_AI_RULES_CHARS);
      } else {
        out[k] = over[k];
      }
    }
  }
  return out;
}

function migrateSettings(settings) {
  // Populate legacy empty Custom fields without changing configured endpoints.
  if (!settings.baseUrl || !settings.baseUrl.trim()) settings.baseUrl = DEFAULTS.baseUrl;
  if (normalizeBaseUrl(settings.baseUrl) === DEFAULTS.baseUrl) {
    const custom = settings.models.custom;
    if (!custom.fast || !custom.fast.trim()) custom.fast = DEFAULTS.models.custom.fast;
    if (!custom.smart || !custom.smart.trim()) custom.smart = DEFAULTS.models.custom.smart;
  }
  const anthropic = settings.models && settings.models.anthropic;
  if (anthropic) {
    if (RETIRED_ANTHROPIC_DEFAULTS.has(anthropic.fast)) anthropic.fast = CURRENT_ANTHROPIC_FAST;
    if (RETIRED_ANTHROPIC_DEFAULTS.has(anthropic.smart)) anthropic.smart = CURRENT_ANTHROPIC_SMART;
  }
  return settings;
}

function readStoredSettings() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid settings');
    return parsed;
  } catch (_) {
    // Preserve recoverable credentials and user text before any defaults are saved.
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, `${FILE}.recovery-${Date.now()}`, fs.constants.COPYFILE_EXCL);
  }
  return {};
}

function load() {
  if (data) return data;
  data = migrateSettings(deepMerge(DEFAULTS, readStoredSettings()));
  return data;
}

function save(nextSettings) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  const temporary = path.join(USER_DATA_DIR, `.clarity-data.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(nextSettings, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, FILE);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    throw new Error(`Could not save Clarity settings: ${error.message}`);
  }
}

module.exports = {
  MAX_AI_RULES_CHARS,
  CURRENT_ANTHROPIC_FAST,
  CURRENT_ANTHROPIC_SMART,
  getSettings() { return load(); },
  setSettings(patch) {
    load();
    const nextSettings = migrateSettings(deepMerge(data, patch || {}));
    nextSettings.baseUrl = normalizeBaseUrl(nextSettings.baseUrl);
    save(nextSettings);
    data = nextSettings;
    return data;
  }
};
