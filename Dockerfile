FROM node:22

RUN apt-get update && \
    apt-get install -y ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev   # modern + cleaner

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]