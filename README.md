# Social Video Fetcher

Phase 1 and Phase 2 of a Node.js social video automation system. The app lets an admin paste a public TikTok, Facebook, YouTube, or YouTube Shorts URL, fetch metadata with `yt-dlp`, download the video locally, and process a final MP4 with the 9ja Trending TV brand animation plus permanent source-section overlays.

This phase intentionally does not include publishing, Cloudinary, Buffer, trend discovery, subtitles, or AI caption rewriting.

## Requirements

- Node.js 20 or newer
- `yt-dlp` installed and available on PATH, or configured with `YTDLP_PATH`
- FFmpeg and ffprobe installed and available on PATH
- Brand animation at `assets/branding/9ja-trending-tv.mp4`
- Logo image at `assets/branding/logo.png`
- Reaction video at `assets/branding/reaction.mp4`

## Install

```bash
npm install
```

On Windows PowerShell, if script execution blocks `npm`, use:

```powershell
npm.cmd install
```

## Configuration

Copy the example environment file and adjust values if needed:

```bash
cp .env.example .env
```

Available settings:

```env
PORT=3000
DOWNLOAD_DIR=storage/downloads
YTDLP_PATH=yt-dlp
MAX_VIDEO_DURATION=0
MAX_DOWNLOAD_SIZE_MB=2000
DOWNLOAD_MAX_HEIGHT=720
YTDLP_TIMEOUT_MINUTES=60
YTDLP_SOCKET_TIMEOUT_SECONDS=30
YTDLP_RETRIES=10
YTDLP_CONCURRENT_FRAGMENTS=4
BRAND_VIDEO_PATH=assets/branding/9ja-trending-tv.mp4
LOGO_PATH=assets/branding/logo.png
REACTION_VIDEO_PATH=assets/branding/reaction.mp4
# Deprecated: brand animation is now outro-only.
FIRST_BRAND_INSERT_SECONDS=10
REPEAT_BRAND_INTERVAL_SECONDS=60
MIN_SOURCE_DURATION_FOR_INSERT_SECONDS=20
MIN_CONTENT_AFTER_BRAND_SECONDS=15
VIDEO_OUTPUT_FPS=24
OUTPUT_MAX_HEIGHT=720
FFMPEG_PRESET=ultrafast
VIDEO_CRF=26
AUDIO_BITRATE=128k
PROCESSING_TIMEOUT_MINUTES=120
LOGO_ENABLED=true
LOGO_WIDTH_PERCENT=16
LOGO_MARGIN_X=24
LOGO_MARGIN_Y=24
REACTION_ENABLED=true
REACTION_WIDTH_PERCENT=45
REACTION_LANDSCAPE_WIDTH_PERCENT=25
REACTION_MARGIN_X=24
REACTION_MARGIN_Y=24
REACTION_MUTED=true
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=flow-social-automation
CLOUDINARY_MAX_UPLOAD_MB=95
CLOUDINARY_UPLOAD_MAX_HEIGHT=480
CLOUDINARY_UPLOAD_AUDIO_BITRATE=96k
CLOUDINARY_UPLOAD_PRESET=ultrafast
CAPTION_MODE=template
BUFFER_API_KEY=
BUFFER_FACEBOOK_CHANNEL_ID=
BUFFER_TIKTOK_CHANNEL_ID=
BUFFER_YOUTUBE_CHANNEL_ID=
BUFFER_POST_MODE=shareNow
BUFFER_FACEBOOK_POST_TYPE=post
BUFFER_YOUTUBE_CATEGORY_ID=22
BUFFER_YOUTUBE_PRIVACY=public
BUFFER_YOUTUBE_MADE_FOR_KIDS=false
BUFFER_DISCLOSE_AI_GENERATED=true
```

Set `MAX_VIDEO_DURATION=0` to allow full-length videos. Use a positive number only if you want to enforce a maximum duration in seconds.

The old mid-roll timing values are kept only for backward compatibility and are not used by the current render path.

For slow or long downloads, increase `YTDLP_TIMEOUT_MINUTES`. `MAX_DOWNLOAD_SIZE_MB` controls the largest source video the downloader will accept. `DOWNLOAD_MAX_HEIGHT=720` avoids downloading huge originals when a social-ready version is enough.

For faster rendering, the defaults use `FFMPEG_PRESET=ultrafast`, `VIDEO_CRF=26`, `VIDEO_OUTPUT_FPS=24`, and `OUTPUT_MAX_HEIGHT=720`. Increase quality later by using `FFMPEG_PRESET=veryfast` and a lower `VIDEO_CRF`, but it will process slower.

## Run

```bash
npm start
```

For development:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Usage

1. Paste a public TikTok, Facebook, YouTube, or YouTube Shorts URL.
2. Click **Fetch Video**.
3. Wait while the app detects the platform, fetches metadata, and downloads the video.
4. Review platform, source, author, duration, caption/title, thumbnail when available, and the local video preview.
5. Click **Process Video** to render the final MP4 with logo/reaction overlays and a single 9ja Trending TV outro.
6. Compare the original and final video previews.
7. Use **Download Video** or **Download Final Video** as needed.

## API

```http
POST /api/media/fetch
Content-Type: application/json

{
  "url": "https://..."
}
```

Asset endpoints:

- `GET /api/media/:jobId/video`
- `GET /api/media/:jobId/video?download=1`
- `POST /api/media/:jobId/process`
- `POST /api/media/:jobId/caption`
- `POST /api/media/:jobId/upload`
- `POST /api/media/:jobId/publish`
- `GET /api/media/:jobId/final`
- `GET /api/media/:jobId/final?download=1`
- `GET /api/media/:jobId/thumbnail`
- `GET /api/media/:jobId/metadata`

Downloaded files are stored under:

```text
storage/downloads/{jobId}/
  source.mp4
  final.mp4
  metadata.json
  thumbnail.jpg|png|webp
```

## FFmpeg Strategy

The editor renders two normalized segments and concatenates them:

- Source segment: the full source video plays continuously with original audio, logo overlay at top-left, and muted looping reaction overlay at bottom-left.
- Outro segment: the complete 9ja Trending TV brand MP4 plays full-screen with its own audio.
- There are no mid-video brand animations or source interruptions.
- Reaction-video audio is never mapped into the output.
- Silent source or brand files receive silent AAC audio so concat remains reliable.
- Segments are normalized to H.264, AAC, yuv420p, 48 kHz stereo, and `VIDEO_OUTPUT_FPS`.
- Visual content is preserved with scale-to-fit plus padding into the source video's frame size.
- The original `source.mp4` is never overwritten; the rendered output is written to `final.mp4`.

Overlay defaults:

- Logo: enabled, top-left, 16% of output width, 24px left/top margins.
- Reaction video: enabled, bottom-left, 45% of output width for portrait videos, 25% for landscape videos, 24px left/bottom margins, muted.
- Reaction looping: FFmpeg uses `-stream_loop -1` and trims the reaction stream to the full source duration.

## Publishing Workflow

After `final.mp4` is created, the dashboard supports manual publishing controls:

1. Generate a new 9ja Trending TV caption from the source metadata.
2. Edit the caption, YouTube title, and YouTube description.
3. Upload only `final.mp4` to Cloudinary.
4. Publish to Facebook, TikTok, and YouTube through Buffer using the Cloudinary `secure_url`.

Cloudinary setup:

- Install is handled by `npm install`; the project uses the official `cloudinary` package.
- Set either `CLOUDINARY_URL` or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- Large videos use Cloudinary's chunked `upload_large` path.
- If `final.mp4` is larger than `CLOUDINARY_MAX_UPLOAD_MB`, the app creates a smaller upload-only copy named `final-cloudinary.mp4` and uploads that while keeping the local `final.mp4` untouched.
- Reprocessing a video clears the previous Cloudinary reference so the new `final.mp4` is uploaded before publishing.

Caption setup:

- `CAPTION_MODE=template` is the current mode.
- Captions are generated from source context but are not copied word-for-word.
- The generated caption always includes `#9jaTrendingTV` plus a small set of contextual/fallback hashtags.

Buffer setup:

- Create a Buffer API key and set `BUFFER_API_KEY`.
- Find each connected channel's ID in Buffer's API/explorer or channel details and set:
  - `BUFFER_FACEBOOK_CHANNEL_ID`
  - `BUFFER_TIKTOK_CHANNEL_ID`
  - `BUFFER_YOUTUBE_CHANNEL_ID`
- The app uses Buffer's GraphQL `createPost` mutation with `assets.video.url` pointing to the Cloudinary URL.
- Publishing results are stored separately per platform, so one platform can fail while others succeed.
- Duplicate protection skips a platform that already has a successful Buffer post ID for the job.

To test without publishing everything, use Generate Caption and Upload Video first, then publish one platform at a time. Set `BUFFER_POST_MODE=draft` to create drafts instead of immediate posts.

## Supported Platforms

- TikTok: `tiktok.com`, `www.tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com`
- Facebook: `facebook.com`, `www.facebook.com`, `m.facebook.com`, `fb.watch`
- YouTube: `youtube.com`, `www.youtube.com`, `youtu.be`, `youtube.com/shorts/...`

## Known Limitations

- Only publicly accessible media that `yt-dlp` can lawfully access is supported.
- The app does not bypass private accounts, DRM, login requirements, geo restrictions, or platform access controls.
- Some platforms change extraction behavior frequently; updating `yt-dlp` is the first troubleshooting step.
- The server performs one synchronous fetch/download request per submitted URL in this phase. A queue or database-backed job tracker can be added later.
