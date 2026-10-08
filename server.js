import express from 'express';
import { YemotRouter } from 'yemot-router2';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app=express();
app.use(express.json());
const keys=(process.env.GEMINI_API_KEYS||'').split(',').map(s=>s.trim()).filter(Boolean);
const models=(process.env.GEMINI_MODELS||'gemini-3-flash-preview,gemini-3.8-flash').split(',').map(s=>s.trim()).filter(Boolean);
const clients=keys.map(k=>new GoogleGenerativeAI(k));
const password=process.env.DASHBOARD_PASSWORD||'1234';
const calls=new Map(),logs=[];
const clean=s=>String(s||'').replace(/[\n\r*#_~`\[\]()<>"'.-]/g,' ').replace(/\s+/g,' ').trim();
async function ask(audio,history){if(!clients.length)throw new Error('GEMINI_API_KEYS missing');const hist=history.map(x=>x.q+' => '+x.a).join(' | ');const prompt=(process.env.AI_SYSTEM_INSTRUCTION||'Answer briefly and clearly in the caller language.')+' History: '+hist+' Return JSON only with transcript and reply.';let last;for(const c of clients)for(const m of models)try{const r=await c.getGenerativeModel({model:m}).generateContent([{inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}},{text:prompt}]);const raw=r.response.text().trim().replace(/^```json\s*/i,'').replace(/\s*```$/i,'');try{const j=JSON.parse(raw);return{q:clean(j.transcript),a:clean(j.reply)}}catch{return{q:'audio',a:clean(raw)}}}catch(e){last=e}throw last||new Error('AI failed')}
async function download(path){const t=String(process.env.YEMOT_API_KEY||'');if(!t)throw new Error('YEMOT_API_KEY missing');const p=path.startsWith('ivr2:')?path:'ivr2:'+path;const r=await fetch('https://www.call2all.co.il/ym/api/DownloadFile?token='+encodeURIComponent(t)+'&path='+encodeURIComponent(p));if(!r.ok)throw new Error('download '+r.status);return Buffer.from(await r.arrayBuffer())}
const router=YemotRouter({printLog:true,defaults:{removeInvalidChars:true}});
router.all('/yemot',async c=>{const id=String(c?.callId||Date.now()),h=[];calls.set(id,{id});try{let first=true;while(true){const rec=await c.read([{type:'text',data:first?'Please say your question after the beep and press # when finished.':'Ask another question, or press * to exit.'}],'record',{min_length:1,no_confirm_menu:true});first=false;if(!rec||rec==='None')break;let o;try{o=await ask(await download(rec),h)}catch(e){o={q:'audio',a:'The request failed. Please try again.'}}h.push(o);if(h.length>12)h.shift();logs.push({time:new Date().toISOString(),id,user:o.q,reply:o.a});if(logs.length>500)logs.shift();await c.id_list_message([{type:'text',data:o.a}],{prependToNextAction:true})}}finally{calls.delete(id)}});
app.use('/',router);
app.get('/health',(_,r)=>r.json({ok:true,status:'online',models,activeCalls:calls.size}));
app.post('/api/verify-auth',(q,r)=>r.json({ok:q.body?.password===password}));
app.get('/api/conversations',(q,r)=>{const k=q.headers['x-dashboard-key']||q.query.key;if(k!==password)return r.status(401).json({error:'Unauthorized'});r.json({conversations:logs,activeCalls:[...calls.values()],totalMessages:logs.length})});
app.get('/',(_,r)=>r.type('html').send('<h1>AI phone line</h1><p>online</p>'));
app.listen(Number(process.env.PORT||3000),()=>console.log('online'));
