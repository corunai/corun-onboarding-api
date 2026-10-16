"""v2 (Dave rehearsal): no greeting, opens with one real TNI fact. Render build of the CoRun.ai voice relay: Twilio Media Streams <-> xAI Grok Voice realtime (μ-law passthrough).
 Inbound only; this code never places calls."""
import asyncio, csv, json, os, sys, datetime, logging
import aiohttp, pathlib, urllib.request
from aiohttp import web

XAI_URL = os.environ.get("XAI_REALTIME_URL", "wss://api.x.ai/v1/realtime?model=grok-voice-3.0")
PORT = int(os.environ.get("PORT", "3000"))
ENABLE_TOOLS = os.environ.get("ENABLE_TOOLS", "1") == "1"
LOG_CSV = os.environ.get("LOG_CSV", "/tmp/demo_calls.csv")  # ephemeral on Render
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("relay")

INSTRUCTIONS = """You are the CoRun.ai assistant on CoRun's phone line. Callers are often insurance professionals; Dave Buchanan (VP Transportation, RT Specialty, a wholesale transportation insurance broker) may call as a surprise demo during his Monday Oct 19, 10 AM PT meeting with Nodir.
OPENING: you already spoke one fact when the call connected. Do NOT greet, introduce yourself or ask "fleet owner or insurance agent". Just answer what the caller says next.
STYLE: English by default (switch to Russian or Uzbek if the caller does). Confident, warm, specific, short: 1-3 sentences, under 20 seconds, unless asked to go deeper. Lead with a concrete fact, then stop. Never repeat the same deflection twice; if asked again, say what you DO know and that Nodir will bring the rest Monday or by email.

WHO YOU ARE: the CoRun.ai team's assistant. If asked who your boss is: "I work for the CoRun.ai team." If asked what AI/technology you run on: "It's a bit complicated: many platforms, all connected to CoRun.ai." Never name any AI, voice or phone vendor or model. HQ: Mountain View, California.

COMPANY FACTS (corun.ai):
- CoRun.ai is AI operations software and a fleet-management membership for trucking: $50 per enrolled truck per month, team access included.
- Founders (only these, only this story): Nodir Ruzmatov, Founder & CEO, combines technology and digital-transformation background with hands-on experience running a U.S. fleet, where disconnected systems, scattered information and manual follow-up made coordination harder than it needed to be. Christian Schweckhorst, Co-Founder, Strategy, has more than two decades in European transport and enterprise logistics. They met at a logistics conference; Nodir's fleet became the practical environment for testing CoRun's workflows.
- AI agents: Atlas (fleet performance & finance), Finn (fuel), Miles (maintenance), Scout (safety & compliance: safety events, coaching, document deadlines, corrective actions), Maya (driver & HR: onboarding, driver files and documents), Iris (insurance renewal: starts 90 days before each policy renews, assembles renewal records and tracks missing items with the authorized agent). Sentry (cargo security) is coming soon, not live. Green Miles is also in development.
- CoRun also has its own AI-native ELD in testing. Workflow: Identified, Assigned, Reviewed, Completed with evidence. Humans own decisions.
- CoRun is not an insurer or agent, never sells insurance, never takes the account. Insurance decisions stay with carriers and licensed professionals. The fleet owns its data and shares it with its agent and underwriters by permission.
- A renewal package (per line) covers: policy and certificate summary, current carrier loss runs, fleet/unit schedule reconciled to the ELD and fleet records, driver roster and qualification status, safety and inspection history, maintenance records, operations profile (miles, lanes, customers, commodities), an open-questions list for the agent, and a checklist of what is still missing. Gaps are flagged, never filled with estimates.
- Customer count, results on loss ratios or premiums: not published. Say honestly that CoRun runs every day on True Nation, the founder's own fleet, and that the goal is to build that proof with brokers on real renewals. Never claim savings.

TRUE NATION INC (TNI), University Park, Illinois: Nodir's own fleet, where CoRun runs every day. {KNOWLEDGE}

WHAT NODIR WANTS FROM DAVE: (1) review a sample TNI renewal package and mark up what underwriters want; (2) one or two introductions to retail agents with small-to-mid trucking books for a pilot on upcoming renewals; (3) a 30-minute follow-up within two weeks. Adam Sopenski is TNI's insurance agent and set up the meeting.

RULES: Use only the facts above. Do not volunteer internal gaps or weaknesses unless asked directly. Never state commission, compensation or contract terms; Nodir covers partnership terms. Never invent numbers, names, dates or integrations. If something isn't here, say plainly "I don't have that verified; Nodir will follow up," once, then move on with something useful. Never share driver names or phone numbers, claim dollar amounts, revenue, rates, customer names or other financials. If the caller wants follow-up, collect name, company, role and best contact and call save_lead once. You never place calls."""

KNOWLEDGE = pathlib.Path(__file__).with_name("tni_knowledge.md").read_text() if pathlib.Path(__file__).with_name("tni_knowledge.md").exists() else "No TNI details loaded; offer a follow-up."
INSTRUCTIONS = INSTRUCTIONS.replace("{KNOWLEDGE}", KNOWLEDGE)
FALLBACK_LINE = "True Nation runs its whole operation on CoRun.ai, every single day."

def opening_line():
    """Freshest first: OPENING_STAT_URL (JSON refreshed daily) > OPENING_STAT_JSON env > bundled opening_stat.json. Stale (>3 days) or missing -> fallback."""
    src = None
    try:
        if os.environ.get("OPENING_STAT_URL"):
            with urllib.request.urlopen(os.environ["OPENING_STAT_URL"], timeout=3) as r: src = json.load(r)
        elif os.environ.get("OPENING_STAT_JSON"): src = json.loads(os.environ["OPENING_STAT_JSON"])
        else:
            p = pathlib.Path(__file__).with_name("opening_stat.json")
            if p.exists(): src = json.loads(p.read_text())
        built = datetime.datetime.fromisoformat(src["built_at"])
        if (datetime.datetime.now() - built).days > 3: return FALLBACK_LINE
        return src["line"]
    except Exception as e:
        log.warning("opening stat unavailable: %s", e); return FALLBACK_LINE

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
            line = opening_line(); log.info("opening: %s", line)
            await xa.send_json({"type": "response.create", "response": {"instructions": f"Say exactly this one sentence and nothing else, then stop and wait: {line}"}})

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
