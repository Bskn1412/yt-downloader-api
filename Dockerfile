# Use Node 22
FROM node:22

# ✅ Install python + ffmpeg + yt-dlp
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python-is-python3 \
    ffmpeg \
    curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]