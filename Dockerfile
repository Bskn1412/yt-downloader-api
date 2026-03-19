# Use official Node 22 LTS image
FROM node:22

# Install ffmpeg (required by yt-dlp for audio/video processing)
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose the port Render will use
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]