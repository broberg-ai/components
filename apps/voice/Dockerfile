# F104.2 — the shared LiveKit media server (voice.broberg.ai, Fly arn).
# Audio only today; video and recording are later stories on the same server.
# base-image exception: LiveKit's own server image (vendor binary), not a Node/Bun app
FROM livekit/livekit-server:v1.13.9
COPY livekit.template.yaml /etc/livekit.template.yaml
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
