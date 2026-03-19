# Use lightweight Node 22 image
FROM node:22-slim

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    python3 \
    python-is-python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files first (better caching)
COPY package*.json ./

# Install Node deps
RUN npm install

# Copy app files
COPY . .

# ✅ Use your custom yt-dlp binary (IMPORTANT)
COPY bin/yt-dlp /usr/local/bin/yt-dlp

# Make it executable
RUN chmod +x /usr/local/bin/yt-dlp

# ✅ Verify binaries during build (helps debugging early)
RUN yt-dlp --version && ffmpeg -version

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]