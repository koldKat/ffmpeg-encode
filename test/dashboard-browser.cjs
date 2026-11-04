// Exercise real modal pointer interactions with isolated API fixtures; no live jobs or database access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const browser = require('./browser-harness.cjs');
const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ffmpeg-dashboard-'));
const publicRoot = path.resolve('public');
const moduleUrl = name => 'file://' + path.join(publicRoot, 'js', name);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = `<script>addEventListener('error',e=>document.body.dataset.failure=e.message);addEventListener('unhandledrejection',e=>document.body.dataset.failure=String(e.reason));</script>
<script type="module">
import {initThemedControls} from '${moduleUrl('themed-controls.js')}';
import {initTooltips} from '${moduleUrl('tooltips.js')}';
import {createActiveQueueAdder} from '${moduleUrl('active-queue-add.js')}';
import {createPathAutocomplete} from '${moduleUrl('path-autocomplete.js')}';
import {escapeHtml} from '${moduleUrl('formatters.js')}';
document.querySelector('#login-screen').style.display='none';document.querySelector('#session-screen').style.display='none';document.querySelector('#app-screen').style.display='block';
const tracks=[{index:0,language:'eng',codec:'aac',channels:2},{index:1,language:'jpn',codec:'aac',channels:2}];
const items=['/source/season/a.mkv','/source/season/b.mkv','/source/root.mkv'].map(fullPath=>({fullPath,path:fullPath.slice(0,fullPath.lastIndexOf('/')),name:fullPath.split('/').pop(),tune:'film',audioTrack:0,audioTracks:tracks,deleteSource:false}));
const test={state:{active:true,startedAt:'2026-11-04T01:00:00Z',config:{sourceRoot:'/source',tune:'film'}},appends:[],stateUpdates:0,holdInspect:false,holdAppend:false,pathRequests:[],holdPaths:false};
const inspection=()=>({found:items.length,inspectionId:'fixture-inspection',items:items.map(item=>({...item}))});
const api=async(url,options={})=>{
 if(url==='/api/queue/inspect'){if(test.holdInspect)return new Promise(resolve=>test.releaseInspect=()=>resolve(inspection()));return inspection();}
 if(url==='/api/queue/append'){const body=JSON.parse(options.body);test.appends.push(body);const result={added:body.items.length,state:structuredClone(test.state)};if(test.holdAppend)return new Promise(resolve=>test.releaseAppend=()=>resolve(result));return result;}
 if(url.startsWith('/api/path-suggest')){if(test.holdPaths)return new Promise(resolve=>test.pathRequests.push({query:new URL('http://test'+url).searchParams.get('q'),resolve}));return {suggestions:[]};}
 throw Error('Unexpected fixture API '+url);
};
const autocomplete=createPathAutocomplete({apiFetch:api,escapeHtml,timing:{debounceMs:30,blurCloseDelayMs:10}});
initThemedControls();initTooltips();
test.adder=createActiveQueueAdder({apiFetch:api,wirePathAutocomplete:autocomplete.wire,onState(state){test.stateUpdates++;test.adder.render(state);}});
test.adder.render(test.state);document.querySelector('#active-queue-path').value='/source';
window.dashboardTest=test;
</script>`;
let html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*type="module"[^>]*src="\/js\/app\.js"[^>]*><\/script>/g, '')
  .replace(/(href|src)="\/(?!\/)/g, '$1="file://' + publicRoot + '/');
html = html.replace('</body>', fixture + '</body>');
const file = path.join(root, 'fixture.html');
fs.writeFileSync(file, html);

async function interactions({ send }) {
  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result?.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(25); }
    throw Error('Timed out: ' + expression);
  }
  async function click(selector) {
    const point = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...point });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...point });
    await delay(40);
  }
  const set = (selector, value) => evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  async function check(expression, label) {
    const value=await evaluate(expression);
    if(value!==true) {
      const detail=await evaluate(`(()=>{const n=window.hintTarget,t=document.querySelector('#dashboard-tooltip'),r=n?.getBoundingClientRect();return{target:n?.outerHTML,rect:r?.toJSON(),hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML:null,tip:t?.outerHTML,active:document.activeElement?.outerHTML,viewport:[innerWidth,innerHeight],events:window.tooltipEvents};})()`);
      throw Error(label+' '+JSON.stringify(detail));
    }
  }
  async function inspect() {
    await set('#active-queue-path','/source');await click('#active-queue-inspect-btn');
    await until('document.querySelector("#active-queue-dialog").open && !document.querySelector("#active-queue-dialog-add").disabled');
  }
  await until('Boolean(window.dashboardTest)');
  await inspect();
  await set('#active-dialog-tune','anima');
  await until('!document.querySelector("#themed-options").hidden');
  await check('document.querySelector("#themed-options").parentElement.id === "active-queue-dialog"','dropdown belongs to modal');
  await click('#themed-options .themed-option');
  await check('document.querySelector("#active-dialog-tune").value === "animation"','real mouse selects filtered tune');
  await click('#active-dialog-apply-tune');
  await check('[...document.querySelectorAll("#active-queue-dialog-list .queue-meta")].every(n=>n.textContent.includes("animation"))','tune applies to grouped and individual files');
  await click('#active-dialog-audio + .themed-select-button');
  await until('!document.querySelector("#themed-options").hidden');
  await evaluate(`document.querySelectorAll('#themed-options .themed-option').forEach(n=>{if(n.textContent.startsWith('Language ENG'))n.dataset.pick='yes';});`);
  await click('#themed-options [data-pick]');
  await check('document.querySelector("#active-dialog-audio").value === "eng"','real mouse selects audio language');
  await click('#active-dialog-apply-audio');
  await set('#active-dialog-save','/output');await click('#active-dialog-apply-save');
  await evaluate(`const rows=[...document.querySelectorAll('#active-queue-dialog-list [data-editor-index]')];const dataTransfer=new DataTransfer();rows[1].querySelector('[data-editor-drag]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));rows[0].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));`);
  await check('document.querySelector("#active-queue-dialog-list .queue-title-text").textContent.includes("root.mkv")','inspected group order changes');
  await evaluate(`document.querySelector('#active-queue-dialog-list .delete-source-group')?.setAttribute('open','');`);
  await click('#active-queue-dialog-list [data-editor-delete-source]');
  await evaluate(`window.editorNode=document.querySelector('#active-queue-dialog-list');dashboardTest.adder.render({...dashboardTest.state,progress:{overallPct:20}});`);
  await check('window.editorNode === document.querySelector("#active-queue-dialog-list") && document.querySelector("#active-dialog-tune").value === "animation"','progress updates preserve draft controls');
  await check('!document.querySelector("[title]")','no default browser title tooltips');
  await evaluate(`window.tooltipEvents=[];for(const type of ['pointerover','pointerout','focusin','focusout','scroll'])document.addEventListener(type,e=>{tooltipEvents.push({type,target:e.target.className||e.target.nodeName,related:e.relatedTarget?.className,time:Math.round(performance.now())});if(tooltipEvents.length>30)tooltipEvents.shift();},true);`);
  const hover = await evaluate(`(()=>{const n=document.querySelector('#active-queue-dialog-list [data-tooltip]');n.scrollIntoView({block:'nearest'});window.hintTarget=n;const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});await delay(450);
  await check('!document.querySelector("#dashboard-tooltip").hidden && document.querySelector("#dashboard-tooltip").closest("dialog").open','themed tooltip visible inside modal');
  await check('getComputedStyle(document.querySelector("#dashboard-tooltip")).backgroundColor === "rgb(16, 26, 43)"','tooltip follows dashboard palette');
  await evaluate('dashboardTest.holdAppend=true');await click('#active-queue-dialog-add');
  await until('Boolean(dashboardTest.releaseAppend)');
  await check('document.querySelector("#active-dialog-tune").disabled && document.querySelector("#active-queue-dialog-list").inert','conflicting edits locked while appending');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await check('document.querySelector("#active-queue-dialog").open','Escape cannot dismiss an in-flight append');
  await evaluate('dashboardTest.releaseAppend();dashboardTest.holdAppend=false');
  await until('!document.querySelector("#active-queue-dialog").open');
  await check('document.querySelector("#active-queue-dialog-list").children.length === 0','closed editor releases its queue DOM');
  await check('dashboardTest.appends[0].items.length===3 && dashboardTest.appends[0].items.every(n=>n.tune==="animation" && n.audioTrack==="eng" && n.saveTo==="/output")','all configured overrides submitted');
  await check('dashboardTest.appends[0].items[0].fullPath === "/source/root.mkv" && dashboardTest.appends[0].items[0].deleteSource === true','order and per-file deletion choice submitted');
  await evaluate('dashboardTest.holdInspect=true');await set('#active-queue-path','/source');await click('#active-queue-inspect-btn');
  await until('Boolean(dashboardTest.releaseInspect)');
  await evaluate('dashboardTest.adder.render({...dashboardTest.state,active:false});dashboardTest.releaseInspect();dashboardTest.holdInspect=false');await delay(50);
  await check('!document.querySelector("#active-queue-dialog").open && document.querySelector("#active-queue-add").hidden','late inspection cannot reopen after batch ends');
  await evaluate('dashboardTest.state={...dashboardTest.state,startedAt:"2026-11-04T02:00:00Z"};dashboardTest.adder.render(dashboardTest.state)');
  await inspect();await evaluate('dashboardTest.holdAppend=true');await click('#active-queue-dialog-add');
  await evaluate('dashboardTest.state={...dashboardTest.state,startedAt:"2026-11-04T03:00:00Z"};dashboardTest.adder.render(dashboardTest.state)');
  await inspect();await evaluate('dashboardTest.releaseAppend();dashboardTest.holdAppend=false');await delay(50);
  await check('document.querySelector("#active-queue-dialog").open && dashboardTest.stateUpdates === 1','late append cannot close a new batch preview or restore old state');
  await click('#active-queue-dialog-cancel');
  await evaluate('dashboardTest.holdPaths=true;dashboardTest.pathRequests=[]');
  await set('#active-queue-path','/source/a');await until('dashboardTest.pathRequests.length===1');
  await set('#active-queue-path','/source/b');
  await evaluate('dashboardTest.pathRequests[0].resolve({suggestions:["/source/old"]})');
  await until('dashboardTest.pathRequests.length===2');
  await check('document.querySelector("#path-suggestions-active-queue").hidden','old query cannot reopen suggestions during a new debounce');
  await evaluate('document.querySelector("#active-queue-path").blur();dashboardTest.pathRequests[1].resolve({suggestions:["/source/new"]})');await delay(50);
  await check('document.querySelector("#path-suggestions-active-queue").hidden','late autocomplete response stays closed after blur');
  await set('#active-queue-path','/source/c');await until('dashboardTest.pathRequests.length===3');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await evaluate('dashboardTest.pathRequests[2].resolve({suggestions:["/source/cached"]})');await delay(50);
  await check('document.querySelector("#path-suggestions-active-queue").hidden','Escape cancels pending autocomplete');
  await evaluate('dashboardTest.holdPaths=false');await inspect();await set('#active-dialog-tune','anima');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await check('document.querySelector("#active-dialog-tune").value === "animation"','Enter selects the filtered first option');
  await set('#active-dialog-tune','anima');
  await check('document.querySelector("#themed-options").getBoundingClientRect().right <= innerWidth','dropdown stays inside viewport');
  await evaluate('document.body.dataset.test=JSON.stringify({modalMouseSelection:true,audioMouseSelection:true,overrides:true,reorder:true,deleteChoice:true,draftPreservedOnProgress:true,themedTooltips:true,pendingAppendLocked:true,lateInspectIgnored:true,lateAppendIgnored:true,staleAutocompleteIgnored:true,escapeCancelsSuggestions:true,viewport:true,keyboardFilteredSelection:true,closedEditorUnloaded:true})');
}
(async()=>{try{
 for(const width of (process.env.DASHBOARD_WIDTHS || '1280,390').split(',').map(Number)){
  const result=await browser({file,root,profile:path.join(root,'profile-'+width),width,chromium:process.env.CHROMIUM,onPage:interactions,screenshotPath:process.env.DASHBOARD_SCREENSHOT_PREFIX?process.env.DASHBOARD_SCREENSHOT_PREFIX+'-'+width+'.jpg':undefined});
  assert.ok(Object.values(result).every(value=>value===true));console.log(JSON.stringify({width,...result}));
 }
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
