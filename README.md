# Play & Whisper — single-folder multiplayer (Ludo + Chess)

## Files in root
index.html, styles.css, app.js, server.py, requirements.txt, Procfile

## Deploy on Render
1. Create a new Web Service on Render.
2. Connect your repo (or upload files).
3. Set Build Command: `pip install -r requirements.txt`
4. Start Command: `gunicorn -k eventlet -w 1 server:app`
5. Ensure port/render settings allow WebSocket (Render supports it).

## How to play
- Open the site.
- Player A: Create Room (choose game), set a secret message, click Create.
- Copy the 6-letter room code and send to your crush.
- Player B: Join Room using code, set secret message.
- Host clicks Start (only starts when both have set secrets).
- Play! Winner receives the secret message via a private reveal.

## Notes
- This is a demo-level implementation (in-memory rooms). For robust production:
  - Add persistent storage.
  - Add authentication and better move validation (full chess rules).
  - Add security checks for large rooms, rate-limiting, etc.
