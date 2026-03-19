import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { createReadStream, unlinkSync, existsSync, statSync, readdirSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import pLimit from "p-limit";

import { spawn, execSync } from "child_process";

const app = express();
const limit = pLimit(3);
const YTDLP = "/usr/local/bin/yt-dlp"; // Linux binary installed in Docker

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Health check
app.get("/", (req, res) => res.send("YT Downloader API running"));

/* =========================
   FORMATS API
========================= */
app.post("/api/formats", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const info = await runYtDlp(url, ["--dump-single-json", "--no-playlist", "--no-warnings"]);
    const data = JSON.parse(info);

    const formats = data.formats || [];
    const video = [], videoOnly = [], audio = [];

    for (const f of formats) {
      const size = f.filesize || f.filesize_approx || 0;
      const obj = {
        id: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : null,
        height: f.height || 0,
        fps: f.fps || 0,
        size,
        vcodec: f.vcodec,
        acodec: f.acodec,
        abr: f.abr || null,
      };

      if (f.vcodec !== "none" && f.acodec !== "none") video.push(obj);
      else if (f.vcodec !== "none" && f.acodec === "none") videoOnly.push(obj);
      else if (f.acodec !== "none" && f.vcodec === "none") audio.push(obj);
    }

    video.sort((a, b) => b.height - a.height);
    videoOnly.sort((a, b) => b.height - a.height);
    audio.sort((a, b) => (b.abr || 0) - (a.abr || 0));

    res.json({
      metadata: {
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        channel: data.uploader,
        views: data.view_count,
        uploadDate: data.upload_date,
      },
      formats: { video, videoOnly, audio },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "yt-dlp failed" });
  }
});

/* =========================
   DOWNLOAD API
========================= */
app.get("/api/download", async (req, res) => {
  const url = req.query.url;
  const formatId = req.query.formatId;
  const title = req.query.title || "video";
  const forceMp3 = req.query.forceMp3 === "true";
  const mp3Bitrate = req.query.mp3Bitrate;

  if (!url) return res.status(400).json({ error: "Missing URL" });

  const tmpDir = tmpdir();
  const uniqueId = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const base = `yt_${uniqueId}`;
  const outputTemplate = path.join(tmpDir, `${base}.%(ext)s`);

  try {
    await limit(() => {
      const args = [
        "-f",
        forceMp3 ? `${formatId || "bestaudio"}/bestaudio/best` : `${formatId}+bestaudio/best`,
        "--no-playlist",
        "--newline",
        "--ffmpeg-location", "/usr/bin", // ffmpeg installed in Docker
        "-o", outputTemplate,
        url,
      ];

      if (forceMp3) {
        args.unshift("--extract-audio", "--audio-format", "mp3");
        if (mp3Bitrate) args.push("--audio-quality", `${mp3Bitrate}K`);
      }

      return runYtDlpProcess(args);
    });

    const finalFile = findDownloadedFile(outputTemplate);
    const ext = path.extname(finalFile).replace(".", "");
    const stream = createReadStream(finalFile);

    const safeTitle = title
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/[^\x00-\x7F]/g, "")
      .slice(0, 120);

    const filename = `${safeTitle}.${ext}`;

    stream.on("close", () => {
      setTimeout(() => {
        try { if (existsSync(finalFile)) unlinkSync(finalFile); } 
        catch (e) { console.error("Cleanup error:", e); }
      }, 1000);
    });

    res.setHeader("Content-Type", getMimeType(ext));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", statSync(finalFile).size);
    stream.pipe(res);

  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: err.message });
  }
});


/* =========================
  debug
========================= */

app.get("/debug", (req, res) => {
  try {
    const ytdlpVersion = execSync("yt-dlp --version").toString();
    const ffmpegVersion = execSync("ffmpeg -version").toString().split("\n")[0];

    res.json({
      ytDlp: ytdlpVersion,
      ffmpeg: ffmpegVersion
    });
  } catch (e) {
    res.json({
      error: e.message
    });
  }
});

/* =========================
   HELPERS
========================= */
function runYtDlp(url, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";

    proc.stdout.on("data", d => { output += d.toString(); });
    proc.stderr.on("data", d => console.error(d.toString()));

    proc.on("close", code => code === 0 ? resolve(output) : reject(new Error(`yt-dlp exited ${code}`)));
    proc.on("error", reject);
  });
}

function runYtDlpProcess(args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { stdio: "inherit" });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`)));
    proc.on("error", reject);
  });
}

function findDownloadedFile(template) {
  const dir = path.dirname(template);
  const base = path.basename(template).replace(".%(ext)s", "");
  const files = readdirSync(dir);
  const match = files.find(f => f.startsWith(base));
  if (!match) throw new Error("Downloaded file not found");
  return path.join(dir, match);
}

function getMimeType(ext) {
  switch (ext) {
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "mkv": return "video/x-matroska";
    case "mp3": return "audio/mpeg";
    case "m4a": return "audio/mp4";
    default: return "application/octet-stream";
  }
}

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));