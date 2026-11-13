FROM node:22-bookworm-slim

# Install system dependencies: ffmpeg (includes ffprobe) and Chrome Headless Shell shared libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libgbm-dev \
    libasound2 \
    libxrandr2 \
    libxkbcommon-dev \
    libxfixes3 \
    libxcomposite1 \
    libxdamage1 \
    libatk-bridge2.0-0 \
    libcups2 \
  && rm -rf /var/lib/apt/lists/*


# ── Piper TTS ──────────────────────────────────────────────────────────────
# A fast local neural narrator. The binary and two voices are baked into the
# image so nothing is downloaded at render time. Piper synthesises at roughly
# twenty times faster than real time, which takes the voiceover stage from
# minutes to seconds on a CPU-only box.
#
#   alan   — British documentary narrator (default)
#   ryan   — American documentary narrator, deeper
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_VOICES_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main
RUN mkdir -p /opt/piper /opt/piper-voices \
 && curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
      | tar xz -C /opt/piper --strip-components=1 \
 && chmod 0755 /opt/piper/piper \
 && for voice in "en/en_GB/alan/medium/en_GB-alan-medium" "en/en_US/ryan/high/en_US-ryan-high"; do \
      name="$(basename "$voice")"; \
      curl -fsSL "${PIPER_VOICES_BASE}/${voice}.onnx"      -o "/opt/piper-voices/${name}.onnx"; \
      curl -fsSL "${PIPER_VOICES_BASE}/${voice}.onnx.json" -o "/opt/piper-voices/${name}.onnx.json"; \
    done \
 # Prove the engine works here, at build time. A schedule that runs at 00:00
 # cannot tell anyone that the narrator is misconfigured, so the build does.
 && (echo "Piper is ready." | /opt/piper/piper --model /opt/piper-voices/en_GB-alan-medium.onnx \
      --output_file /tmp/piper-check.wav) \
 && test -s /tmp/piper-check.wav \
 && rm -f /tmp/piper-check.wav /opt/piper/*.tar.gz

ENV PIPER_BINARY=/opt/piper/piper \
    PIPER_MODEL=/opt/piper-voices/en_GB-alan-medium.onnx

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable pnpm

# Install dependencies (pnpm workspace — root + web only, docs deploys separately)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --filter=!docs

# Install Chrome Headless Shell for Remotion rendering
RUN npx remotion browser ensure

# Copy full source
COPY . .

# Build frontend
RUN cd web && npx vite build

# Word-alignment model, baked in. The aligner caches to ./.cache, so this both
# warms the cache and proves the model downloads cleanly at build time.
RUN node scripts/prefetch-aligner.mjs && du -sh .cache

# Create directories
RUN mkdir -p /output /app/jobs

# Default: CLI mode (backwards compatible)
ENTRYPOINT ["npx", "tsx", "src/index.ts", "--yes", "-o", "/output"]
