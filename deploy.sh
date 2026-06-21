#!/bin/bash
set -e

echo "🔥 Firebox WhatsApp Bot — VPS Deploy Script"
echo "────────────────────────────────────────────"

# ── Check Docker ────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! command -v docker compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
  echo "📦 Installing Docker Compose..."
  apt-get install -y docker-compose-plugin 2>/dev/null || \
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
fi

# ── Check .env ──────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo ""
  echo "⚠️  No .env file found. Creating one now..."
  echo "   Fill in the values below (press Enter to skip optional ones):"
  echo ""

  read -p "OWNER_NUMBER (your WhatsApp number, e.g. 254712345678): " OWNER_NUMBER
  read -p "OWNER_NAME (your name, e.g. John): " OWNER_NAME
  read -p "PREFIX (default: .): " PREFIX
  PREFIX=${PREFIX:-.}
  read -p "GEMINI_API_KEY (for AI features, optional): " GEMINI_API_KEY
  read -p "OPENROUTER_API_KEY (for AI features, optional): " OPENROUTER_API_KEY
  read -p "RAPIDAPI_KEY (for some search commands, optional): " RAPIDAPI_KEY
  read -p "SESSION_ID (paste your Baileys session ID if migrating, optional): " SESSION_ID
  read -p "TZ (timezone, e.g. Africa/Nairobi): " TZ
  TZ=${TZ:-Africa/Nairobi}

  cat > .env <<EOF
OWNER_NUMBER=${OWNER_NUMBER}
OWNER_NAME=${OWNER_NAME}
PREFIX=${PREFIX}
GEMINI_API_KEY=${GEMINI_API_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
RAPIDAPI_KEY=${RAPIDAPI_KEY}
SESSION_ID=${SESSION_ID}
TZ=${TZ}
NODE_ENV=production
EOF

  echo "✅ .env file created."
fi

# ── Create folders ──────────────────────────────────────────────────────────
mkdir -p data session tmp

# ── Build & start ───────────────────────────────────────────────────────────
echo ""
echo "🔨 Building Docker image..."
docker compose build --no-cache

echo ""
echo "🚀 Starting Firebox bot..."
docker compose up -d

echo ""
echo "✅ Bot is running!"
echo "📋 View logs:    docker compose logs -f"
echo "🛑 Stop bot:     docker compose down"
echo "🔄 Restart bot:  docker compose restart"
echo "🌐 Dashboard:    http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'):5000"
