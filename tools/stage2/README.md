# Reconstructed Stage 2 verification

Run package-specific validators and tests documented in docs/city-life-transit/STAGE2_HANDOFF.md. After the full production build, run:

    python3 tools/stage2/verify_isolation.py

This static check ensures exact new GLB/Blender/preview bytes and source-only consumer references do not appear in dist/client. It does not establish browser/network/resource-lifetime or WebGL acceptance. Existing build gates and their original asset protection are unchanged.
