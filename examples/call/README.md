# examples/call — a test harness for @broberg/call (F104.7 / F104.8)

Two (or more) people in the same room on the real media server (voice.broberg.ai),
driven by Lens. Not a product page.

    LIVEKIT_KEY_FILE=… LIVEKIT_SECRET_FILE=… bun examples/call/server.ts   # :5199

- `/?id=alice` — one participant. Buttons: join, camera, screen share, leave.
- `/?id=load&n=5` — five participants in this page, each with its camera on (load test).
- `/token?id=…&room=…` — mints a ticket with camera + screen share for the test room.

The credentials are read from FILES (never env values in argv, never committed).
Rooms are named `components-test:<room>`, so they never collide with a product's rooms.
