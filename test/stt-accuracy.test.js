const test = require('node:test');
const assert = require('node:assert');
const { looksLikeHallucination, buildVocabPrompt, buildVocabTerms } = require('../src/stt');
const { DeepgramStreamingSTT, OpenAIRealtimeSTT } = require('../src/stt-streaming');

test('looksLikeHallucination drops Whisper silence artifacts', () => {
  ['', '   ', 'Thank you for watching.', 'thanks for watching', 'Bye-bye!', '👍👍'].forEach((s) => {
    assert.equal(looksLikeHallucination(s), true, JSON.stringify(s));
  });
});

test('looksLikeHallucination keeps real speech', () => {
  ['Tell me about your experience with Kubernetes.', 'You know, I led the migration.'].forEach((s) => {
    assert.equal(looksLikeHallucination(s), false, JSON.stringify(s));
  });
});

test('buildVocabPrompt seeds base vocab and resume proper nouns, capped', () => {
  const p = buildVocabPrompt({ resumeText: 'Optum EKS Terraform', jobDescription: 'AWS SRE' });
  assert.ok(p.includes('Kubernetes'));
  assert.ok(p.includes('Optum'));
  assert.ok(p.length <= 850);
  assert.ok(buildVocabPrompt(undefined).length > 0);
  assert.ok(buildVocabPrompt({ resumeText: 'Xyzzy '.repeat(4000) }).length <= 850);
});

test('buildVocabTerms prioritizes resume and job-description terminology for streaming STT', () => {
  const terms = buildVocabTerms({ resumeText: 'Vanderbilt Supabase LangChain', jobDescription: 'Kubernetes AWS' });
  assert.ok(terms.includes('Vanderbilt'));
  assert.ok(terms.includes('Supabase'));
  assert.ok(terms.includes('Kubernetes'));
  assert.ok(terms.length <= 80);
});

test('OpenAI realtime accumulates transcript deltas per item before exposing interim text', () => {
  const interim = [];
  const finals = [];
  const stt = new OpenAIRealtimeSTT('k', {
    onInterim: (text) => interim.push(text),
    onTranscript: (text) => finals.push(text)
  });
  stt._handleEvent({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'Tell me ' });
  stt._handleEvent({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'about yourself' });
  stt._handleEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: 'Tell me about yourself.' });
  assert.deepEqual(interim, ['Tell me ', 'Tell me about yourself', '']);
  assert.deepEqual(finals, ['Tell me about yourself.']);
});

test('Deepgram accumulates is_final segments into one turn at speech_final', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._handleMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Tell me about' }] } });
  d._handleMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'your experience' }] } });
  d._handleMessage({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'with Kubernetes.' }] } });
  assert.deepEqual(finals, ['Tell me about your experience with Kubernetes.']);
});

test('Deepgram flushes pending segments on UtteranceEnd when speech_final never arrives', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._handleMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'hello there' }] } });
  d._handleMessage({ type: 'UtteranceEnd' });
  assert.deepEqual(finals, ['hello there']);
  d._handleMessage({ type: 'UtteranceEnd' });
  assert.deepEqual(finals, ['hello there'], 'no duplicate emit on a second UtteranceEnd');
});

test('Deepgram drops hallucinated finals', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._handleMessage({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'Thank you.' }] } });
  assert.deepEqual(finals, []);
});

test('Deepgram flushes a pending final segment before an unexpected reconnect', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._committed = 'partial question before disconnect';
  d._manualStop = false;
  let reconnects = 0;
  d._attemptReconnect = () => { reconnects += 1; };
  d._clearKeepAlive = () => {};
  d.onStatusChange = () => {};
  d._handleClose(1006);
  assert.deepEqual(finals, ['partial question before disconnect']);
  assert.equal(d._committed, '');
  assert.equal(reconnects, 1);
});
