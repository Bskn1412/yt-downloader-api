import express from "express";
import cors from "cors";
import ytdlp from "yt-dlp-exec";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Health check
app.get("/", (req, res) => res.send("YT Downloader API running"));

// Extract formats
app.post("/api/formats", async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const data = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noPlaylist: true
    });

    // Format response like your Vercel version
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
      else if (f.vcodec !== "none" && f.acodec === "none") videoOnly.push(obj);
      else if (f.acodec !== "none" && f.vcodec === "none") audio.push(obj);
    }

    // Sort and respond
    video.sort((a,b)=>b.height-a.height);
    videoOnly.sort((a,b)=>b.height-a.height);
    audio.sort((a,b)=>(b.abr||0)-(a.abr||0));

    res.json({
      metadata: {
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        channel: data.uploader,
        views: data.view_count,
        uploadDate: data.upload_date
      },
      formats: { video, videoOnly, audio }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "yt-dlp failed" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));