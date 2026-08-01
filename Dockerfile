FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp and ensure the binary is at /app/bin/yt-dlp for the bot
RUN python3 -m pip install --break-system-packages yt-dlp 2>/dev/null || pip3 install --break-system-packages yt-dlp || true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

# Put a fresh yt-dlp binary in ./bin/ so index.js doesn't re-download it at runtime.
# Try pip-installed binary first, fall back to downloading standalone binary.
RUN mkdir -p bin tmp data session && \
    YT=$(which yt-dlp 2>/dev/null || find /usr /root /home -name yt-dlp 2>/dev/null | head -1 || echo '') && \
    if [ -n "$YT" ] && [ -x "$YT" ]; then \
        cp "$YT" bin/yt-dlp && chmod +x bin/yt-dlp && echo "yt-dlp copied from $YT"; \
    else \
        echo "Downloading yt-dlp standalone binary..." && \
        curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
             -o bin/yt-dlp && chmod +x bin/yt-dlp && echo "yt-dlp downloaded"; \
    fi && \
    bin/yt-dlp --version

ENV NODE_ENV=production
ENV PREFIX=.
ENV TZ=Africa/Nairobi

EXPOSE 5000

CMD ["node", "index.js"]
