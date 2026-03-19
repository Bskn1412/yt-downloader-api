# Use official Node 22 LTS image
FROM node:22

# ✅ Install python + ffmpeg (BOTH required)
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python-is-python3 \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# ✅ Now npm install (python is available)
RUN npm install

# Copy the rest of the app
COPY . .

# Expose the port Render will use
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]