const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),os=require('os'),path=require('path');
const {isLikelyTranscriptEcho}=require('../src/live-answer');
const {createTranscriptArchive}=require('../src/transcript-archive');
const question='What is the difference between an array and a linked list?';
function harness(){
 let now=1000;const turns=[],events=[];
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clarity-echo-'));
 const archive=createTranscriptArchive({directory:dir,now:()=>now});const file=archive.start().file;
 const c=vm.createContext({transcript:turns,transcriptArchive:archive,isLikelyTranscriptEcho,Date:{now:()=>now},recordEvent:()=>{},pushTranscript:t=>{turns.push(t);archive.append(t)},send:(name,data)=>events.push({name,data})});
 const s=fs.readFileSync(require.resolve('../main.js'),'utf8');vm.runInContext(s.slice(s.indexOf('let transcriptSessionStartedAt'),s.indexOf('async function startLocalWhisper')),c);
 return {turns,events,send:(channel,text,ts)=>{now=ts;c.publishTranscript(channel,text)},text:()=>fs.readFileSync(file,'utf8'),clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('echo correction handles both completion orders and corrects saved speaker attribution',()=>{
 for(const order of [['you','them'],['them','you']]){const h=harness();try{h.send(order[0],question,1000);h.send(order[1],question,7000);assert.equal(h.turns.length,1);assert.equal(h.turns[0].channel,'them');assert.doesNotMatch(h.text(),/You:/);assert.equal(h.text().split('Them:').length-1,1);if(order[0]==='you')assert(h.events.some(e=>e.name==='transcript:sync'));}finally{h.clean()}}
});
test('echo detection crosses intervening speech without dropping that speech or genuine disagreement',()=>{
 const h=harness();try{h.send('them',question,1000);h.send('you','Let me think about that.',2000);h.send('you',question,6000);assert.equal(h.turns.length,2);assert.equal(isLikelyTranscriptEcho('I do not think we should deploy this change to production today','I think we should deploy this change to production today'),false);h.send('you',question,20000);assert.equal(h.turns.length,3);}finally{h.clean()}
});
function devices(){
 let acquisitions=0,closed=0,toggles=0;const tracks=[];const messages=[];
 const make=()=>{const track={label:'headset',readyState:'live',stop(){this.readyState='ended'}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track],getVideoTracks:()=>[]}};
 const context=vm.createContext({isMac:false,isWindows:false,$:()=>({classList:{contains:()=>true}}),clarity:{platform:'linux',log:()=>{},captureToggle:async()=>toggles++},showStatus:s=>messages.push(s),MediaStream:class{},navigator:{mediaDevices:{getUserMedia:async()=>{acquisitions++;return make()},getDisplayMedia:async()=>make()}},AudioContext:class{constructor(){this.audioWorklet={addModule:async()=>{}}}resume(){}createMediaStreamSource(){return {connect(){}}}close(){closed++}},AudioWorkletNode:class{constructor(){this.port={}}connect(){}disconnect(){}}});
 const s=fs.readFileSync(require.resolve('../renderer/renderer.js'),'utf8');vm.runInContext(s.slice(s.indexOf('  let audioCtx ='),s.indexOf('  // ---- STT / VAD status helpers')),context);
 return {context,tracks,messages,stats:()=>({acquisitions,closed,toggles})};
}
test('ended microphone reacquires once and stale track events cannot stop the replacement',async()=>{
 const h=devices();await h.context.startMic();const first=h.tracks[0];first.onended();await new Promise(setImmediate);assert.equal(h.stats().acquisitions,2);first.onended();assert.equal(h.stats().acquisitions,2);h.tracks[1].onended();await new Promise(setImmediate);assert.equal(h.stats().acquisitions,2);assert(h.messages.at(-1).includes('restart listening'));h.context.stopMic();
});
test('ended loopback stops listening and permits a fresh user-initiated capture',async()=>{
 const h=devices();await h.context.startSystemAudio();h.tracks[0].onended();assert.equal(h.stats().toggles,1);await h.context.startSystemAudio();assert.equal(h.tracks.length,2);h.context.stopSystemAudio();
});
