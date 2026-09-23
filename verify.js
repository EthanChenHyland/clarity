const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');

const defPos = src.indexOf('function getOrCreateInterimEl');
const handlerPos = src.indexOf("clarity.on('stt:interim'");
const r1 = defPos !== -1 && handlerPos !== -1 && defPos < handlerPos;
console.log('1. interim transcript helper defined before stt:interim:', r1);

const clearDefPos = src.indexOf('function clearTranscriptInterim');
const finalHandlerPos = src.indexOf("clarity.on('stt:final'");
const r2 = clearDefPos !== -1 && finalHandlerPos !== -1 && clearDefPos < finalHandlerPos;
console.log('2. clearTranscriptInterim defined before stt:final:', r2);

const toastDefPos = src.indexOf('function showToast');
const clearBtnHandlerPos = Math.max(
  src.indexOf("clearTranscriptBtn.addEventListener"),
  src.indexOf("clearTranscriptBtn?.addEventListener")
);
const r3 = toastDefPos !== -1 && clearBtnHandlerPos !== -1 && toastDefPos < clearBtnHandlerPos;
console.log('3. showToast defined before clear btn addEventListener:', r3, '(toast:', toastDefPos, 'handler:', clearBtnHandlerPos, ')');

const llmStartIdx = src.indexOf("clarity.on('llm:start'");
const llmTokenIdx = src.indexOf("clarity.on('llm:token'");
const llmStartBlock = src.substring(llmStartIdx, llmTokenIdx);
const r4 = !llmStartBlock.includes('clearMessages()');
console.log('4. llm:start does NOT call clearMessages():', r4);

const tabClickPos = src.indexOf("querySelectorAll('.s-tab').forEach");
const tabLogicEnd = src.indexOf('function updateCustomProviderFields', tabClickPos);
const tabBlock = src.substring(tabClickPos, tabLogicEnd);
const closeSettingsPos = src.indexOf('async function closeSettings()');
const closeSettingsEnd = src.indexOf("$('#more-btn').addEventListener", closeSettingsPos);
const closeSettingsBlock = src.substring(closeSettingsPos, closeSettingsEnd);
const r5 = tabClickPos !== -1 && !tabBlock.includes('saveSettings()') && closeSettingsBlock.includes('await saveSettings()');
console.log('5. settings tabs navigate without saving; close saves settings:', r5);

const allPass = r1 && r2 && r3 && r4 && r5;
console.log('\nAll checks passed:', allPass);
process.exit(allPass ? 0 : 1);
