Render web service. Build: pip install -r requirements.txt. Start: python relay.py. Health: /healthz.
Env: XAI_API_KEY (required), PUBLIC_HOST (optional, e.g. corun-voice-relay.onrender.com), VOICE (default Ara), PYTHON_VERSION=3.12.7.
Twilio Voice webhook: https://<host>/twiml (POST). Media stream WS: wss://<host>/media
