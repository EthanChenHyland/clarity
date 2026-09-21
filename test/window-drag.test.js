const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
test('explicit drag preserves window size, uses screen coordinates, and ends safely',()=>{
 const src=fs.readFileSync(require.resolve('../main.js'),'utf8');let handler,cursor={x:300,y:200},yielding=false;const positions=[];
 const win={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:100,y:100,width:1130,height:800}),setIgnoreMouseEvents(){},setPosition:(x,y)=>positions.push([x,y])};
 vm.runInNewContext(src.slice(src.indexOf('let windowDrag'),src.indexOf('let toolbarWakeTimer')), {win,ipcMain:{on:(_,cb)=>handler=cb},isMainRendererSender:s=>s==='main',isForegroundYieldActive:()=>yielding,screen:{getCursorScreenPoint:()=>cursor}});
 handler({sender:'other'},'start');handler({sender:'main'},'move');assert.equal(positions.length,0);
 handler({sender:'main'},'start');cursor={x:450,y:240};handler({sender:'main'},'move');assert.deepEqual(positions,[[250,140]]);
 handler({sender:'main'},'end');cursor.x=500;handler({sender:'main'},'move');assert.equal(positions.length,1);
 handler({sender:'main'},'start');yielding=true;handler({sender:'main'},'move');yielding=false;handler({sender:'main'},'move');assert.equal(positions.length,1);
});
