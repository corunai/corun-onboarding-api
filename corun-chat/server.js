const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const SYSTEM = require('./prompt');
const insurancePrompt = require('./prompt-insurance');
const KEY = process.env.XAI_API_KEY, MODEL = process.env.MODEL || 'grok-4.20-non-reasoning';
const PORT = process.env.PORT || 3000;

// ---- Private insurance mode -------------------------------------------------------------
// Off unless BOTH an access-code hash and a knowledge pack are configured on the server.
// ADAM_ACCESS_CODE_SHA256 = hex SHA-256 of the private code (the code itself is never stored).
// The code arrives in the Referer (https://corun.ai/agency?code=...) or in a body field "code".
const CODE_HASH = (process.env.ADAM_ACCESS_CODE_SHA256 || '').trim().toLowerCase();
function loadPack(){
  if (process.env.INSURANCE_PACK) return process.env.INSURANCE_PACK;
  try { return fs.readFileSync('/etc/secrets/insurance_pack.md', 'utf8'); } catch(e) { return ''; }
}
const PACK = loadPack();
const INSURANCE_SYSTEM = (/^[0-9a-f]{64}$/.test(CODE_HASH) && PACK.trim()) ? insurancePrompt(PACK) : null;
const REFERER_HOSTS = new Set(['corun.ai', 'www.corun.ai']);
function codeOk(code){
  if (!INSURANCE_SYSTEM || typeof code !== 'string' || code.length < 16 || code.length > 128) return false;
  const a = crypto.createHash('sha256').update(code, 'utf8').digest();
  return crypto.timingSafeEqual(a, Buffer.from(CODE_HASH, 'hex'));
}
function insuranceMode(req, body){
  if (!INSURANCE_SYSTEM) return false;
  if (body && typeof body.code === 'string' && codeOk(body.code)) return true;
  try {
    const u = new URL(req.headers.referer || req.headers.referrer || '');
    if (u.protocol === 'https:' && REFERER_HOSTS.has(u.hostname) && codeOk(u.searchParams.get('code'))) return true;
  } catch(e) {}
  return false;
}
// Last-resort output guard for insurance mode: no vendor names, no phone numbers.
const VENDOR_RE = /\b(grok|xai|x\.ai|openai|chatgpt|gpt-?\d|anthropic|claude|gemini|llama|mistral)\b/i;
const PHONE_RE = /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const PLATFORM_LINE = "It's a bit complicated: I use many platforms, and all of them are connected to CoRun.ai.";
function guard(reply){
  reply = reply.replace(/\bTNI's\b/g, "the carrier's").replace(/\bTNI\b/g, 'the carrier');
  if (/CoRun Cloud/i.test(reply)) return PLATFORM_LINE;
  if (VENDOR_RE.test(reply)) return "It's a bit complicated: I use many platforms, and all of them are connected to CoRun.ai.";
  if (PHONE_RE.test(reply)) return "I can't share personal contact details. Nodir can help with anything driver-specific.";
  return reply;
}
if (INSURANCE_SYSTEM) console.log('insurance mode: configured'); // never log the code or the pack
// ----------------------------------------------------------------------------------------

const hits = new Map(); // ip -> [timestamps]
function limited(ip){const now=Date.now();const a=(hits.get(ip)||[]).filter(t=>now-t<60000);a.push(now);hits.set(ip,a);
  const day=(hits.get(ip+':d')||[]).filter(t=>now-t<86400000);day.push(now);hits.set(ip+':d',day);return a.length>10||day.length>200;}
setInterval(()=>{const now=Date.now();for(const[k,v]of hits){if(!v.some(t=>now-t<86400000))hits.delete(k);}},600000).unref();
const types={'.html':'text/html; charset=utf-8','.png':'image/png','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  if(req.method==='POST'&&req.url==='/api/chat'){
    if(limited(ip)){res.writeHead(429,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Too many messages. Please wait a minute.'}));}
    let body='';req.on('data',c=>{body+=c;if(body.length>20000)req.destroy();});
    req.on('end',async()=>{try{
      const parsed=JSON.parse(body);const {messages}=parsed;
      const msgs=(Array.isArray(messages)?messages:[]).slice(-12).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,2000)}));
      if(!msgs.length)throw new Error('empty');
      const ins=insuranceMode(req,parsed);
      const r=await fetch('https://api.x.ai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+KEY},
        body:JSON.stringify(ins
          ?{model:MODEL,temperature:0.2,max_tokens:700,messages:[{role:'system',content:INSURANCE_SYSTEM},...msgs]}
          :{model:MODEL,temperature:0.7,max_tokens:500,messages:[{role:'system',content:SYSTEM},...msgs]})});
      const j=await r.json();let reply=j.choices?.[0]?.message?.content;
      if(!reply){console.error('upstream',r.status,JSON.stringify(j).slice(0,300));throw new Error('upstream');}
      if(ins)reply=guard(reply);
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({reply}));
    }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Sorry, something went wrong. Please try again.'}));}});
    return;
  }
  if(req.url==='/healthz'){res.writeHead(200);return res.end('ok');}
  let p=req.url.split('?')[0];if(p==='/')p='/index.html';
  const f=path.join(__dirname,'public',path.normalize(p).replace(/^(\.\.[\/\\])+/,''));
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});res.end(d);});
}).listen(PORT,()=>console.log('listening',PORT));
