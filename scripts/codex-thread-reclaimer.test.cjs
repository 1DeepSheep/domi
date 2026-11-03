const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexThreadReclaimer } = require('../electron/codex-thread-reclaimer.cjs');

test('only idle terminal threads unsubscribe; concurrent release is coalesced and follow-up waits', async () => {
 const calls=[]; let unblock;
 const c={child:{},request:async(method,params)=>{calls.push([method,params.threadId]);
  if(method==='thread/read')return {thread:{id:params.threadId,status:{type:'idle'}}};
  return new Promise(r=>{unblock=()=>r({status:'unsubscribed'});});}};
 const r=new CodexThreadReclaimer();const a=r.release(c,'a');assert.equal(r.release(c,'a'),a);
 let followed=false;const wait=r.wait('a').then(()=>{followed=true;});
 await new Promise(setImmediate);assert.equal(followed,false);unblock();assert.equal(await a,true);await wait;
 assert.deepEqual(calls,[['thread/read','a'],['thread/unsubscribe','a']]);assert.equal(r.pending.size,0);
});
for(const state of ['active','notLoaded'])test(`does not terminate ${state} thread`,async()=>{
 const calls=[];const c={child:{},request:async m=>{calls.push(m);return {thread:{id:'a',status:{type:state}}};}};
 assert.equal(await new CodexThreadReclaimer().release(c,'a'),false);assert.deepEqual(calls,['thread/read']);
});
test('closed transport is not restarted and release failure never fails a completed task',async()=>{
 const errors=[];const r=new CodexThreadReclaimer({onError:e=>errors.push(e.message)});
 assert.equal(await r.release({child:null},'a'),false);
 assert.equal(await r.release({child:{},request:async()=>{throw Error('offline');}},'a'),false);
 assert.deepEqual(errors,['offline']);assert.equal(r.pending.size,0);
});

test('real idle scheduler defers for running/preparing tasks and pending IPC, then resets only its own client',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
 const fn=source.match(/function scheduleIdleCodexRelease\([^]*?\n\}\n/)[0];
 let timer,resets=0;
 const c={codexClient:{pending:new Map()},activeRuns:new Map(),startingCodexRunIds:new Set(),
  codexThreadReclaimer:{pending:new Map()},pendingRunPostProcessing:new Set(),codexIdleReleaseTimer:null,
  clearTimeout(){},setTimeout(callback,ms){assert.equal(ms,30000);timer=callback;return {unref(){}};},
  resetCodexClient(){resets++;},appendRuntimeLog(){}};
 vm.createContext(c);vm.runInContext(fn,c);
 c.scheduleIdleCodexRelease();c.activeRuns.set('task',{});timer();assert.equal(resets,0);
 c.activeRuns.clear();c.scheduleIdleCodexRelease();c.startingCodexRunIds.add('preflight');timer();assert.equal(resets,0);
 c.startingCodexRunIds.clear();c.scheduleIdleCodexRelease();c.codexClient.pending.set('rpc',{});timer();assert.equal(resets,0);
 c.codexClient.pending.clear();timer();assert.equal(resets,1);
 c.scheduleIdleCodexRelease();c.codexClient={pending:new Map()};timer();assert.equal(resets,1);
});
