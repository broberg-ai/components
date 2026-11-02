# F104.9.2 — LiveKit Egress: records a whole call (room composite, Chrome) to R2.
# Configuration is the EGRESS_CONFIG_BODY Fly secret (keys, Redis, R2) — never this file.
# Its shape in v1.15 (measured 2/11 2026 — older keys are silently ignored):
#   api_key, api_secret, ws_url: wss://voice.broberg.ai, health_port: 8080,
#   logging: { level }, redis: { address: broberg-voice-redis.internal:6379, password },
#   storage: { s3: { access_key, secret, endpoint: <R2 EU endpoint>, region: auto,
#              bucket: broberg-call-recordings, force_path_style: true } },
#   debug: { enable_chrome_logging }   # writes the recording browser's console to its tmp dir
# A top-level `s3:` or `log_level:` is NOT read: the file then lands on local disk
# («Local upload failed») and logging stays at info.
# Media reaches this machine over Fly's private network only: broberg-voice
# offers its fdaa:: address as an ICE candidate (apps/voice/livekit.template.yaml).
# base-image exception: LiveKit's own egress image (vendor binary + Chrome), not a Node/Bun app
FROM livekit/egress:v1.15.0
