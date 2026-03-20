import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import {
  createReadStream,
  unlink,
  existsSync,
  statSync,
  readdirSync
} from "fs";
import path from "path";
import { tmpdir } from "os";
import pLimit from "p-limit";

const app = express();
const limit = pLimit(3);

const YTDLP = "yt-dlp"; // use global path (Docker installs it globally)

app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* =========================
   HEALTH
========================= */
app.get("/", (req, res) => {
  res.send("YT Downloader API running 🚀");
});

/* =========================
   FORMATS API
========================= */
app.post("/api/formats", async (req, res) => {
  let { url } = req.body;

  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    url = decodeURIComponent(url);

    const output = await runYtDlp([
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      url
    ]);

    const data = JSON.parse(output);

    const formats = data.formats || [];

    const video = [];
    const videoOnly = [];
    const audio = [];

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
        abr: f.abr || null
      };

      if (f.vcodec !== "none" && f.acodec !== "none") video.push(obj);
      else if (f.vcodec !== "none") videoOnly.push(obj);
      else if (f.acodec !== "none") audio.push(obj);
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
        views: data.view_count
      },
      formats: { video, videoOnly, audio }
    });

  } catch (err) {
    console.error("Formats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   DOWNLOAD API
========================= */
app.get("/api/download", async (req, res) => {
  let { url, formatId, title, forceMp3, mp3Bitrate } = req.query;

  if (!url) return res.status(400).json({ error: "Missing URL" });

  url = decodeURIComponent(url);
  forceMp3 = forceMp3 === "true";

  const tmpDir = tmpdir();
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const base = `yt_${unique}`;
  const outputTemplate = path.join(tmpDir, `${base}.%(ext)s`);

  try {
    await limit(() => {
      const args = [
        "--no-playlist",
        "--newline",
        "-o", outputTemplate,
        url
      ];

      // FORMAT FIX (important)
      let formatSelector = "best";

      if (forceMp3) {
        formatSelector = formatId || "bestaudio";
        args.push(
          "-f", formatSelector,
          "--extract-audio",
          "--audio-format", "mp3"
        );

        if (mp3Bitrate) {
          args.push("--audio-quality", `${mp3Bitrate}K`);
        }

      } else {
        formatSelector = formatId
          ? `${formatId}+bestaudio/best`
          : "best";

        args.push("-f", formatSelector);
      }

      return runYtDlpProcess(args);
    });

    const finalFile = findFile(outputTemplate);
    const ext = path.extname(finalFile).slice(1);

    const safeTitle = (title || "video")
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/[^\x00-\x7F]/g, "")
      .slice(0, 100);

    const filename = `${safeTitle}.${ext}`;

    res.setHeader("Content-Type", getMime(ext));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", statSync(finalFile).size);

    const stream = createReadStream(finalFile);

    stream.pipe(res);

    stream.on("close", () => {
      setTimeout(() => {
        if (existsSync(finalFile)) {
          unlink(finalFile, () => {});
        }
      }, 2000);
    });

  } catch (err) {
    console.error("Download error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   DEBUG
========================= */
app.get("/debug", async (req, res) => {
  try {
    const yt = await runYtDlp(["--version"]);
    const ff = await runCmd("ffmpeg -version");

    res.json({
      ytDlp: yt.trim(),
      ffmpeg: ff.split("\n")[0]
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* =========================
   HELPERS
========================= */

function runYtDlp(args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args);

    let out = "";
    let err = "";

    proc.stdout.on("data", d => out += d.toString());
    proc.stderr.on("data", d => err += d.toString());

    proc.on("close", code => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `yt-dlp exited ${code}`));
    });
  });
}

function runYtDlpProcess(args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args);

    let err = "";

    proc.stderr.on("data", d => err += d.toString());

    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(err || `yt-dlp exited ${code}`));
    });
  });
}

function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, { shell: true });

    let out = "";
    proc.stdout.on("data", d => out += d.toString());

    proc.on("close", () => resolve(out));
    proc.on("error", reject);
  });
}

function findFile(template) {
  const dir = path.dirname(template);
  const base = path.basename(template).replace(".%(ext)s", "");

  const file = readdirSync(dir).find(f => f.startsWith(base));
  if (!file) throw new Error("File not found");

  return path.join(dir, file);
}

function getMime(ext) {
  return {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    m4a: "audio/mp4"
  }[ext] || "application/octet-stream";
}

/* =========================
   START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});