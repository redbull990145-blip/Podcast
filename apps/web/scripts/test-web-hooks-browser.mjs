/** Browser regressions for the actual hooks/event binding; synthetic React fixture only. */
/* global document, window */ // Functions passed to page.evaluate execute in Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { outputFiles } = await build({ bundle: true, write: false, format: 'iife', jsx: 'automatic', stdin: {
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx', contents: `
import {useState,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {useModalSheet} from './lib/modal-sheet';
import {useOnScreen} from './lib/on-screen';
import {attachTranscriptReader} from './lib/transcript-reader';
function Nested({close}) {const ref=useRef(null); useModalSheet({open:true,onClose:close,containerRef:ref});
 return createPortal(<div role="dialog" ref={ref}><button id="inner-first">First</button><button id="inner-last">Last</button></div>,document.body);}
function Fixture(){const ref=useRef(null);const [open,setOpen]=useState(false);const [nested,setNested]=useState(false);
 const [mounted,setMounted]=useState(false);const [box,setBox]=useState(null);const following=useRef(true);const visible=useOnScreen(box,'0px');
 useModalSheet({open,onClose:()=>setOpen(false),containerRef:ref});
 useEffect(()=>box?attachTranscriptReader(box,following,p=>window.yielded=p,100):undefined,[box]);
 useEffect(()=>{window.fixture={mount:setMounted,following:()=>following.current,visible:()=>visible,box:()=>box};},[visible,box]);
 return <><button id="open" onClick={()=>setOpen(true)}>Open</button><button id="mount" onClick={()=>setMounted(true)}>Mount later</button>
 {open&&<><div id="backdrop" onClick={()=>setOpen(false)}>Backdrop</div><div role="dialog" ref={ref}><button id="outer-first">First</button><button id="nested" onClick={()=>setNested(true)}>Speed</button><button id="outer-last">Last</button>{nested&&<Nested close={()=>{setNested(false);document.querySelector('#nested').focus();}}/>}</div></>}
 {mounted&&<div id="reader" ref={setBox} style={{height:100,overflow:'auto'}}><div style={{height:1000}}>Transcript</div></div>}</>}
createRoot(document.getElementById('root')).render(<Fixture/>);
` } });
const server = createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(`<div id="root"></div><script>${outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
let browser; const checks=[];
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.click('#mount'); await page.waitForSelector('#reader');
 await page.evaluate(()=>{const box=document.querySelector('#reader');box.scrollTop=200;box.dispatchEvent(new Event('wheel'));});
 assert.equal(await page.evaluate(()=>window.fixture.following()),false);
 assert.equal(await page.evaluate(()=>window.yielded),200);
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.fixture.following()),true);
 checks.push('delayed scroll mount yields on wheel and resumes after bounded delay');
 await page.evaluate(()=>{document.querySelector('#reader').dispatchEvent(new Event('touchmove'));window.fixture.mount(false);});
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.fixture.following()),false);
 await page.evaluate(()=>window.fixture.mount(true));await page.waitForSelector('#reader');
 await page.evaluate(()=>document.querySelector('#reader').dispatchEvent(new Event('wheel')));
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.fixture.following()),true);
 checks.push('unmount cancels timer/listeners and remount attaches again');
 await page.evaluate(()=>document.querySelector('#reader').style.marginTop='2000px');
 await page.waitForFunction(()=>window.fixture.visible()===false);
 assert.equal(await page.evaluate(()=>window.fixture.visible()),false);
 checks.push('visibility observer attaches after delayed mount');
 await page.click('#open');await page.waitForTimeout(50);await page.focus('#outer-last');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'outer-first');
 await page.click('#nested');await page.waitForTimeout(50);await page.focus('#inner-last');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'inner-first');
 await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'inner-last');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#inner-first').count(),0);
 assert.equal(await page.locator('#outer-first').count(),1);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'nested');
 checks.push('portal dialog owns Tab/Shift+Tab/Escape and restores its trigger');
 await page.click('#backdrop');assert.equal(await page.locator('#outer-first').count(),0);
 checks.push('outer backdrop closes without changing presentation');
 process.stdout.write(`${JSON.stringify({browser:await browser.version(),environment:'real Chromium DOM + actual React hooks, synthetic fixture',passed:checks.length,checks},null,2)}\n`);
}finally{await browser?.close();await new Promise((r)=>server.close(r));}
