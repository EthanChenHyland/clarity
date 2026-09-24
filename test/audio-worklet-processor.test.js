const assert = require('node:assert/strict');
const test = require('node:test');
const { downmixToMono, AudioMixer, AudioConditioner } = require('../renderer/audio-worklet-processor');
const { UtteranceSegmenter } = require('../src/utterance-segmenter');
const speech = Float32Array.from({length:4096}, (_,i)=>0.014*Math.sin(2*Math.PI*500*i/16000));
const silent = new Float32Array(speech.length);
function detect(channels) {
  let utterances = 0;
  const segmenter = new UtteranceSegmenter({channel:'them',vadOptions:{onsetThreshold:200,offsetThreshold:120,silenceFrames:20},onUtterance:()=>utterances++});
  const conditioner = new AudioConditioner(4);
  for(let block=0;block<13;block++) {
    const data=conditioner.process(block<8?downmixToMono(channels):silent);
    const pcm=Buffer.alloc(data.length*2);
    data.forEach((x,i)=>pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),i*2));
    segmenter.push(pcm);
  }
  segmenter.stop();return utterances;
}
test('quiet speech survives silent left/right channels and phase cancellation through VAD',()=>{
  for(const channels of [[speech],[speech,silent],[silent,speech],[speech,Float32Array.from(speech,x=>-x)],[speech,speech]]) {
    assert.equal(detect(channels),1);
  }
});
test('silence remains silent and bounded gain does not create speech from low noise',()=>{
  assert.equal(detect([silent,silent]),0);
  const noise=Float32Array.from(speech,(_,i)=>i%2?0.0001:-0.0001);
  assert.equal(detect([noise,noise]),0);
});
test('mono and duplicated stereo preserve the original waveform',()=>{
  assert.equal(downmixToMono([speech]),speech);
  assert.deepEqual(downmixToMono([speech,speech]),speech);
  assert.equal(downmixToMono([speech,silent]),speech);
});
test('conditioner limits peaks and leaves default microphone gain unchanged',()=>{
  const loud=Float32Array.from([0,0.01,1,-1,0.5]);
  assert.equal(new AudioConditioner().process(loud),loud);
  const out=new AudioConditioner(4).process(loud);
  assert.ok(out.every(x=>Math.abs(x)<=0.900001));
  assert.equal(out[0],0);
});
test('real-time mixer reuses scratch storage without changing downmix behavior',()=>{
  const mixer=new AudioMixer();
  const phaseOpposed=Float32Array.from(speech,x=>-x);
  const mixed=mixer.process([speech,speech]);
  assert.deepEqual(mixed,speech);
  const scratch=mixer._mono;
  mixer.process([speech,speech]);
  assert.equal(mixer._mono,scratch);
  assert.equal(mixer.process([speech,silent]),speech);
  assert.equal(mixer.process([speech,phaseOpposed]),speech);
});
