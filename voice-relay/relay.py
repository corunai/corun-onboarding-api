"""Render build of the CoRun.ai DEMO voice relay: Twilio Media Streams <-> xAI Grok Voice realtime (μ-law passthrough).
 Inbound only; this code never places calls."""
import asyncio, csv, json, os, sys, datetime, logging
import aiohttp
from aiohttp import web

XAI_URL = os.environ.get("XAI_REALTIME_URL", "wss://api.x.ai/v1/realtime?model=grok-voice-3.0")
PORT = int(os.environ.get("PORT", "3000"))
ENABLE_TOOLS = os.environ.get("ENABLE_TOOLS", "1") == "1"
LOG_CSV = os.environ.get("LOG_CSV", "/tmp/demo_calls.csv")  # ephemeral on Render
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("relay")

INSTRUCTIONS = """You are the friendly CoRun.ai demo assistant on CoRun's demo phone line. Inbound demo only.
Open with: "Hi, thanks for calling CoRun.ai! This call may be recorded for quality. Are you a fleet owner, or an insurance agent?"
Speak English by default. If the caller speaks Russian, switch to Russian. If they speak Uzbek, answer in Uzbek as best you can (or offer Russian/English).
Be warm, conversational, brief: every answer under about 30 seconds. Explain only what is relevant to their role, then invite questions.

FACTS (use ONLY these; never add anything else):
- CoRun.ai is AI operations software and a fleet-management membership for trucking, priced at $50 per truck per month.
- Founded by Nodir Ruzmatov (Founder and CEO) with co-founder Christian Schweckhorst.
- AI department agents: Finn for fuel; Miles for maintenance and repairs; Scout for safety and compliance; Maya for driver support and HR; Atlas for fleet performance and finance; Iris for insurance-renewal prep, starting 90 days before renewal.
- Also included: Weekly Briefs, task follow-up, monthly reviews, member sessions, an agency workspace for insurance agents, and the dashboard at dashboard.corun.ai.
- It works from the fleet's own ELD (for example Motive) and the fleet's own data.
- Coming later: cargo security and Green Miles.
- For insurance agents: CoRun gives organized, renewal-ready fleet safety and compliance packages, plus the agency workspace.

RULES: Never invent metrics, results, customer names, prices other than $50 per truck per month, integrations, or dates/timelines. If you don't know or it isn't in the facts, say so and offer a follow-up from the team, or point them to corun.ai.
If the caller wants a follow-up, ask for their name, company, role and best phone or email, then call the save_lead tool once. You never place calls or promise specific times.
STANDING RULES (always): Never name Grok, xAI, or any AI vendor, model or provider. If asked what technology or AI you run on, say: "It's a bit complicated: many platforms, all connected to CoRun.ai." CoRun.ai headquarters is Mountain View, California. Never share sensitive or internal information (internal numbers, customer data, finances, credentials, personal contact details of the team)."""

def _write(fn, args, call_sid):
    new = not os.path.exists(LOG_CSV)
    with open(LOG_CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["timestamp", "call_sid", "event", "details_json"])
        w.writerow([datetime.datetime.now().isoformat(timespec="seconds"), call_sid, fn, json.dumps(args, ensure_ascii=False)])
    return {"ok": True}

FUNCS = {"save_lead": lambda a, sid: _write("save_lead", a, sid)}
TOOLS = [{"type": "function", "name": "save_lead", "description": "Save a caller's follow-up request (demo stub)",
  "parameters": {"type": "object", "properties": {"name": {"type": "string"}, "company": {"type": "string"}, "role": {"type": "string", "enum": ["fleet_owner", "insurance_agent", "other"]}, "contact": {"type": "string"}, "notes": {"type": "string"}}}}]

def session_update():
    s = {"voice": os.environ.get("VOICE", "Ara"), "instructions": INSTRUCTIONS,
         "turn_detection": {"type": "server_vad"},
         "audio": {"input": {"format": {"type": "audio/pcmu"}}, "output": {"format": {"type": "audio/pcmu"}}}}
    if ENABLE_TOOLS: s["tools"] = TOOLS
    return {"type": "session.update", "session": s}

async def twiml(req):
    host = os.environ.get("PUBLIC_HOST") or req.headers.get("X-Forwarded-Host") or req.host
    xml = f'<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://{host}/media"/></Connect></Response>'
    return web.Response(text=xml, content_type="text/xml")

async def health(req): return web.Response(text="ok" if os.environ.get("XAI_API_KEY") else "missing XAI_API_KEY", status=200 if os.environ.get("XAI_API_KEY") else 503)

async def media(req):
    tw = web.WebSocketResponse(); await tw.prepare(req)
    stream_sid = call_sid = None
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect(XAI_URL, headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"}) as xa:
            log.info("xAI connected")
            await xa.send_json(session_update())
            await xa.send_json({"type": "response.create"})  # greet first

            async def from_twilio():
                nonlocal stream_sid, call_sid
                async for m in tw:
                    if m.type != aiohttp.WSMsgType.TEXT: break
                    d = json.loads(m.data); ev = d.get("event")
                    if ev == "start":
                        stream_sid = d["start"]["streamSid"]; call_sid = d["start"].get("callSid")
                        log.info("call start %s", call_sid); _write("call_start", {"from": d["start"].get("customParameters", {})}, call_sid)
                    elif ev == "media":
                        await xa.send_json({"type": "input_audio_buffer.append", "audio": d["media"]["payload"]})
                    elif ev == "stop": break
                await xa.close()

            async def from_xai():
                async for m in xa:
                    if m.type != aiohttp.WSMsgType.TEXT: break
                    d = json.loads(m.data); t = d.get("type", "")
                    if t in ("response.output_audio.delta", "response.audio.delta") and stream_sid:
                        await tw.send_json({"event": "media", "streamSid": stream_sid, "media": {"payload": d["delta"]}})
                    elif t == "input_audio_buffer.speech_started" and stream_sid:
                        await tw.send_json({"event": "clear", "streamSid": stream_sid})  # barge-in
                    elif t == "response.function_call_arguments.done":
                        fn = FUNCS.get(d.get("name"))
                        out = fn(json.loads(d.get("arguments") or "{}"), call_sid) if fn else {"error": "unknown"}
                        await xa.send_json({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": d.get("call_id"), "output": json.dumps(out)}})
                        await xa.send_json({"type": "response.create"})
                    elif t == "error": log.warning("xAI error: %s", d)
                    elif t.endswith("transcript.done"): log.info("%s: %s", t, d.get("transcript"))
                await tw.close()

            await asyncio.gather(from_twilio(), from_xai(), return_exceptions=True)
    log.info("call end %s", call_sid)
    return tw

app = web.Application()
app.router.add_route("*", "/twiml", twiml)
app.router.add_get("/media", media)
app.router.add_get("/health", health)
app.router.add_get("/healthz", health)
app.router.add_get("/", health)
if __name__ == "__main__": web.run_app(app, host="0.0.0.0", port=PORT)
