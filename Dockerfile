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

RUN python3 -m pip install --break-system-packages yt-dlp 2>/dev/null || pip3 install yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p data session tmp

ENV NODE_ENV=production
ENV PREFIX=.
ENV TZ=Africa/Nairobi

EXPOSE 5000

CMD ["node", "index.js"]
