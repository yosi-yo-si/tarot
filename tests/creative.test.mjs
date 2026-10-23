import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { Miniflare } from "miniflare";
import { CreativeQuota } from "../creative-worker.mjs";

const origin = "https://tsukiyo-arcana.pages.dev";
const sample = { question: "父の食堂を継いだ架空の主人公。新しい料理に挑戦したい。", spread: 3, tone: "serious" };
const fakeResult = {ok:true,role:"creative",shop:true,cards:[{i:0,rev:true},{i:5,rev:true},{i:3,rev:false}],ai:"ok",reading:"【過去】\n試してきました。\n【現在】\n考えています。\n【未来】\n育てていけそうです。",remaining:19};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) { for (let i=0; i<200; i++) { if(predicate()) return; await pause(10); } assert.fail("UI did not settle"); }
function page(file, fetcher, owner=false) {
  const errors=[];
  const vc=new VirtualConsole(); vc.on("jsdomError", error=>errors.push(error));
  const dom=new JSDOM(readFileSync(new URL("../"+file,import.meta.url),"utf8"), {
    url:origin+"/"+file,runScripts:"dangerously",virtualConsole:vc,
    beforeParse(w) {
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
      w.matchMedia=()=>({matches:true});w.AbortController=AbortController;
      const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timer(fn,ms<10000?1:ms,...args);
      w.fetch=fetcher;
      if(owner){w.localStorage.setItem("arcana.code","test-owner-code");w.localStorage.setItem("arcana.role","owner");}
    }
  });
  return {dom,w:dom.window,d:dom.window.document,errors};
}

test("creative page starts without auth, draws AI, preserves salon credentials, and clears for another story", async()=>{
  const calls=[]; const p=page("creative.html",async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(fakeResult);},true);
  try {
    assert.deepEqual(p.errors,[]);assert.equal(p.d.querySelector("#qBox").hidden,false);
    assert.equal(p.d.querySelector("#salonLink").hidden,true);
    assert.equal(p.d.querySelector("#modeSerious").getAttribute("aria-pressed"),"true");
    assert.equal(p.d.querySelector("#nThree").getAttribute("aria-pressed"),"true");
    p.d.querySelector("#drawBtn").click();await pause(20);assert.equal(calls.length,0);
    p.d.querySelector("#qIn").value=sample.question;p.d.querySelector("#drawBtn").click();
    await waitFor(()=>p.d.querySelector("#reading").textContent.includes("育てていけそう"));
    assert.equal(calls.length,1);assert.equal(calls[0].body.code,"");assert.equal(calls[0].body.spread,3);
    assert.match(calls[0].url,/\/api\/creative\/draw$/);
    assert.equal(p.w.localStorage.getItem("arcana.code"),"test-owner-code");
    assert.equal(p.w.localStorage.getItem("arcana.role"),"owner");
    assert.match(p.d.querySelector("#remain").textContent,/19/);
    assert.equal(p.d.querySelector("#qIn").value,"");
    await waitFor(()=>!p.d.querySelector("#drawBtn").disabled);
    p.d.querySelector("#nextBtn").click();assert.doesNotMatch(p.d.querySelector("#reading").textContent,/育てていけそう/);
    assert.deepEqual(p.errors,[]);
  }finally{p.dom.window.close();}
});

test("creative network failure preserves the question and does not pretend to produce a local AI result",async()=>{
  const p=page("creative.html",async()=>{throw Error("offline");});
  try {p.d.querySelector("#qIn").value=sample.question;p.d.querySelector("#drawBtn").click();
    await waitFor(()=>p.d.querySelector("#remain").textContent.includes("接続できません"));
    assert.equal(p.d.querySelector("#qIn").value,sample.question);
    assert.equal(p.d.querySelectorAll(".is-open").length,0);
  }finally{p.dom.window.close();}
});

test("creative daily limit disables further draws",async()=>{
  const p=page("creative.html",async()=>Response.json({ok:false,error:"limit"},{status:429}));
  try {p.d.querySelector("#qIn").value=sample.question;p.d.querySelector("#drawBtn").click();
    await waitFor(()=>p.d.querySelector("#remain").textContent.includes("使い切りました"));
    assert.equal(p.d.querySelector("#drawBtn").disabled,true);
  }finally{p.dom.window.close();}
});

test("salon anonymous and owner modes keep their original access behavior",()=>{
  for(const owner of [false,true]){const p=page("salon.html",async()=>{throw Error("unexpected fetch");},owner);
    try{assert.deepEqual(p.errors,[]);assert.equal(p.d.querySelector("#qBox").hidden,!owner);
      assert.equal(p.d.querySelector("#salonLink").hidden,false);
      assert.match(p.d.querySelector("#remain").textContent,owner?/オーナー用/:/あと3回/);
    }finally{p.dom.window.close();}}
});

test("quota resets on a new Japanese calendar day",async()=>{
  let state={day:"2000-01-01",used:20};
  const object=new CreativeQuota({storage:{transaction:async fn=>fn({get:async()=>state,put:async(k,v)=>{state=v;}})}},{});
  const res=await object.fetch();assert.equal((await res.json()).remaining,19);assert.equal(state.used,1);
});

test("real Worker runtime admits exactly 20 of 35 simultaneous attempts; no request can obtain an owner role",async()=>{
  let providerCalls=0;
  const mf=new Miniflare({modules:true,scriptPath:new URL("../creative-worker.mjs",import.meta.url).pathname,
    compatibilityDate:"2026-08-01",bindings:{CREATIVE_ENABLED:"1",ANTHROPIC_API_KEY:"test-key"},
    durableObjects:{CREATIVE_QUOTA:{className:"CreativeQuota",useSQLite:true}},
    outboundService:async request=>{assert.equal(new URL(request.url).hostname,"api.anthropic.com");providerCalls++;
      return Response.json({stop_reason:"end_turn",content:[{type:"text",text:"架空の読み解きです。"}]});}
  });
  const send=(body,extra={})=>mf.dispatchFetch("https://creative.test/api/creative/draw",{method:"POST",headers:{origin,"content-type":"application/json",...extra},body:JSON.stringify(body)});
  try{
    assert.equal((await send({...sample,question:""})).status,400);
    assert.equal((await send({...sample,question:"あ".repeat(301)})).status,400);
    assert.equal((await send({...sample,spread:1})).status,400);
    assert.equal((await send(sample,{origin:"https://example.com"})).status,403);
    assert.equal((await mf.dispatchFetch("https://creative.test/api/check",{method:"POST"})).status,404);
    const responses=await Promise.all(Array.from({length:35},()=>send({...sample,role:"owner",code:"ignored"})));
    assert.equal(responses.filter(r=>r.status===200).length,20);
    assert.equal(responses.filter(r=>r.status===429).length,15);assert.equal(providerCalls,20);
    for(const r of responses.filter(r=>r.status===200)){
      assert.equal(r.headers.get("access-control-allow-origin"),origin);
      const j=await r.json();assert.equal(j.role,"creative");assert.equal(j.ai,"ok");
      assert.equal(new Set(j.cards.map(c=>c.i)).size,3);assert.ok(j.remaining>=0&&j.remaining<20);
    }
    assert.equal((await send(sample)).status,429);assert.equal(providerCalls,20);
  }finally{await mf.dispose();}
});

test("disabled or unconfigured public API fails closed",async()=>{
  const mf=new Miniflare({modules:true,scriptPath:new URL("../creative-worker.mjs",import.meta.url).pathname,compatibilityDate:"2026-08-01"});
  try{const r=await mf.dispatchFetch("https://creative.test/api/creative/draw",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(sample)});assert.equal(r.status,503);}
  finally{await mf.dispose();}
});
