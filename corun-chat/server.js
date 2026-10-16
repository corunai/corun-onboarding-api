const http = require('http'), fs = require('fs'), path = require('path');
const SYSTEM = require('./prompt');
const KEY = process.env.XAI_API_KEY, MODEL = process.env.MODEL || 'grok-4.20-non-reasoning';
const PORT = process.env.PORT || 3000;
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
      const {messages}=JSON.parse(body);
      const msgs=(Array.isArray(messages)?messages:[]).slice(-12).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,2000)}));
      if(!msgs.length)throw new Error('empty');
      const r=await fetch('https://api.x.ai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+KEY},
        body:JSON.stringify({model:MODEL,temperature:0.7,max_tokens:500,messages:[{role:'system',content:SYSTEM},...msgs]})});
      const j=await r.json();const reply=j.choices?.[0]?.message?.content;
      if(!reply){console.error('upstream',r.status,JSON.stringify(j).slice(0,300));throw new Error('upstream');}
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({reply}));
    }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Sorry, something went wrong. Please try again.'}));}});
    return;
  }
  if(req.url==='/healthz'){res.writeHead(200);return res.end('ok');}
  let p=req.url.split('?')[0];if(p==='/')p='/index.html';
  const f=path.join(__dirname,'public',path.normalize(p).replace(/^(\.\.[\/\\])+/,''));
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});res.end(d);});
}).listen(PORT,()=>console.log('listening',PORT));
