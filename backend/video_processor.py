import re
import os
import asyncio
import httpx
from models import VideoMetadata


def detect_platform(url: str) -> str:
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    elif "instagram.com" in url:
        return "instagram"
    raise ValueError(f"Unsupported platform for URL: {url}")


def extract_youtube_id(url: str) -> str:
    patterns = [
        r"youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})",
        r"youtu\.be/([a-zA-Z0-9_-]{11})",
        r"youtube\.com/shorts/([a-zA-Z0-9_-]{11})",
        r"youtube\.com/embed/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    raise ValueError(f"Cannot extract YouTube video ID from: {url}")


def format_duration(seconds: int) -> str:
    if not seconds:
        return "N/A"
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m {s}s"


def _parse_iso_duration(s: str) -> int:
    if not s:
        return 0
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s)
    if not m:
        return 0
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)


class VideoProcessor:

    async def process_video(self, url: str, video_id: str) -> VideoMetadata:
        platform = detect_platform(url)
        if platform == "youtube":
            return await self._process_youtube(url, video_id)
        elif platform == "instagram":
            return await self._process_instagram(url, video_id)
        raise ValueError(f"Unsupported platform: {platform}")

    # ─── YouTube ────────────────────────────────────────────────────────────────

    async def _process_youtube(self, url: str, video_id: str) -> VideoMetadata:
        yt_id = extract_youtube_id(url)

        transcript, metadata_raw = await asyncio.gather(
            self._fetch_youtube_transcript(yt_id),
            self._fetch_youtube_metadata(yt_id),
        )

        views    = int(metadata_raw.get("views", 0))
        likes    = int(metadata_raw.get("likes", 0))
        comments = int(metadata_raw.get("comments", 0))
        eng_rate = round((likes + comments) / views * 100, 4) if views else 0.0
        duration = metadata_raw.get("duration", 0) or 0

        return VideoMetadata(
            video_id=video_id,
            url=url,
            platform="youtube",
            title=metadata_raw.get("title", "Unknown"),
            creator=metadata_raw.get("author", "Unknown"),
            follower_count=metadata_raw.get("subscriber_count"),
            views=views,
            likes=likes,
            comments=comments,
            engagement_rate=eng_rate,
            hashtags=metadata_raw.get("hashtags", []),
            upload_date=metadata_raw.get("upload_date"),
            duration=duration,
            duration_str=format_duration(duration),
            transcript=transcript,
            thumbnail=f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg",
            description=metadata_raw.get("description", ""),
        )

    async def _fetch_youtube_transcript(self, yt_id: str) -> str:
        """
        Fetch transcript via YouTube Data API v3 captions endpoint.
        Falls back to description-based stub if no API key or captions unavailable.
        """
        yt_api_key = os.getenv("YOUTUBE_API_KEY", "")

        # Method 1: YouTube Data API v3 — fetch caption track then download it
        if yt_api_key:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    # List available caption tracks
                    r = await client.get(
                        "https://www.googleapis.com/youtube/v3/captions",
                        params={"videoId": yt_id, "part": "snippet", "key": yt_api_key},
                    )
                    items = r.json().get("items", [])

                    # Pick English track, fallback to first available
                    track_id = None
                    for item in items:
                        lang = item["snippet"].get("language", "")
                        if lang.startswith("en"):
                            track_id = item["id"]
                            break
                    if not track_id and items:
                        track_id = items[0]["id"]

                    if track_id:
                        # Download the caption track (returns XML/SRT)
                        r2 = await client.get(
                            f"https://www.googleapis.com/youtube/v3/captions/{track_id}",
                            params={"tfmt": "srt", "key": yt_api_key},
                            headers={"Accept": "text/plain"},
                        )
                        raw = r2.text
                        # Strip SRT timestamps and indices, keep text only
                        lines = []
                        for line in raw.splitlines():
                            line = line.strip()
                            if not line:
                                continue
                            if re.match(r"^\d+$", line):
                                continue
                            if re.match(r"^\d{2}:\d{2}:\d{2}", line):
                                continue
                            lines.append(line)
                        transcript = " ".join(lines)
                        if transcript:
                            print(f"[captions-api] got transcript for {yt_id}")
                            return transcript
            except Exception as e:
                print(f"[captions-api] failed: {e}")

        # Method 2: youtube-transcript-api
        try:
            from youtube_transcript_api import YouTubeTranscriptApi

            loop = asyncio.get_event_loop()

            def _get():
                try:
                    return YouTubeTranscriptApi.get_transcript(yt_id, languages=["en", "en-US", "en-GB"])
                except Exception:
                    transcript_list = YouTubeTranscriptApi.list_transcripts(yt_id)
                    t = next(iter(transcript_list))
                    return t.fetch()

            segs = await loop.run_in_executor(None, _get)
            text = " ".join(seg["text"] for seg in segs)
            if text:
                print(f"[transcript-api] got transcript for {yt_id}")
                return text
        except Exception as e:
            print(f"[transcript-api] failed: {e}")

        # Method 3: Pull description as fallback context
        print(f"[transcript] all methods failed for {yt_id}, using description fallback")
        return (
            "[Auto-captions unavailable from Docker environment due to YouTube bot detection. "
            "The RAG system will use video metadata (title, stats, description, hashtags) for analysis. "
            "To enable transcripts: add YOUTUBE_API_KEY to .env, or run the backend outside Docker "
            "on a residential IP where youtube-transcript-api works without bot checks.]"
        )

    async def _fetch_youtube_metadata(self, yt_id: str) -> dict:
        data = {
            "title": "Unknown", "author": "Unknown",
            "views": 0, "likes": 0, "comments": 0,
            "hashtags": [], "duration": 0,
            "subscriber_count": None, "upload_date": None,
            "description": "",
        }

        yt_api_key = os.getenv("YOUTUBE_API_KEY", "")

        # YouTube Data API v3 — full stats
        if yt_api_key:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.get(
                        "https://www.googleapis.com/youtube/v3/videos",
                        params={
                            "id": yt_id,
                            "part": "statistics,contentDetails,snippet",
                            "key": yt_api_key,
                        },
                    )
                    items = r.json().get("items", [])
                    if items:
                        stats   = items[0].get("statistics", {})
                        details = items[0].get("contentDetails", {})
                        snippet = items[0].get("snippet", {})

                        data["title"]       = snippet.get("title", "Unknown")
                        data["author"]      = snippet.get("channelTitle", "Unknown")
                        data["views"]       = int(stats.get("viewCount", 0) or 0)
                        data["likes"]       = int(stats.get("likeCount", 0) or 0)
                        data["comments"]    = int(stats.get("commentCount", 0) or 0)
                        data["upload_date"] = snippet.get("publishedAt", "")[:10]
                        data["description"] = snippet.get("description", "")[:500]
                        data["duration"]    = _parse_iso_duration(details.get("duration", ""))
                        data["hashtags"]    = re.findall(r"#\w+", data["description"])[:20]

                        print(f"[yt-api] views={data['views']} likes={data['likes']} title={data['title']}")
                        return data
            except Exception as e:
                print(f"[yt-api] failed: {e}")

        # Fallback: noembed — title + author only, no stats
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://noembed.com/embed",
                    params={"url": f"https://www.youtube.com/watch?v={yt_id}"},
                )
                j = r.json()
                data["title"]  = j.get("title", "Unknown")
                data["author"] = j.get("author_name", "Unknown")
                print(f"[noembed] title={data['title']}")
        except Exception as e:
            print(f"[noembed] failed: {e}")

        if not yt_api_key:
            print("[yt-api] No YOUTUBE_API_KEY — add it to .env for views/likes/comments/duration")

        return data

    # ─── Instagram ──────────────────────────────────────────────────────────────

    async def _process_instagram(self, url: str, video_id: str) -> VideoMetadata:
        metadata_raw = await self._fetch_instagram_metadata(url)
        transcript   = self._make_instagram_transcript(metadata_raw)

        views    = int(metadata_raw.get("views", 0))
        likes    = int(metadata_raw.get("likes", 0))
        comments = int(metadata_raw.get("comments", 0))

        if views > 0:
            # Standard ER formula
            eng_rate = round((likes + comments) / views * 100, 4)
        elif likes > 0:
            # Views hidden — comment rate as proxy (comments / likes * 100)
            eng_rate = round(comments / likes * 100, 4)
        else:
            eng_rate = 0.0

        duration = metadata_raw.get("duration", 0) or 0

        return VideoMetadata(
            video_id=video_id,
            url=url,
            platform="instagram",
            title=metadata_raw.get("title", "Instagram Reel"),
            creator=metadata_raw.get("author", "Unknown"),
            follower_count=metadata_raw.get("follower_count"),
            views=views,
            likes=likes,
            comments=comments,
            engagement_rate=eng_rate,
            hashtags=metadata_raw.get("hashtags", []),
            upload_date=metadata_raw.get("upload_date"),
            duration=duration,
            duration_str=format_duration(duration),
            transcript=transcript,
            thumbnail=metadata_raw.get("thumbnail"),
            description=metadata_raw.get("description", ""),
        )

    def _extract_instagram_username(self, url: str) -> str:
        """Extract @username from Instagram URL."""
        m = re.search(r"instagram\.com/([^/?#]+)", url)
        if m:
            username = m.group(1).strip("/")
            if username not in ("reel", "p", "tv", "stories"):
                return username
        return "Unknown"

    async def _fetch_instagram_metadata(self, url: str) -> dict:
        # Extract username from URL as reliable fallback
        username = self._extract_instagram_username(url)

        try:
            import yt_dlp
            loop = asyncio.get_event_loop()

            def _extract():
                ydl_opts = {
                    "quiet": True,
                    "skip_download": True,
                    "no_warnings": True,
                }
                # Use cookies file if available for full stats including view count
                cookies_path = os.path.join(os.path.dirname(__file__), "instagram_cookies.txt")
                if os.path.exists(cookies_path):
                    ydl_opts["cookiefile"] = cookies_path
                    print(f"[instagram] using cookies file for authenticated request")
                else:
                    print(f"[instagram] no cookies file found at {cookies_path} — view count may be unavailable")

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    return ydl.extract_info(url, download=False)

            info = await loop.run_in_executor(None, _extract)
            desc = info.get("description", "") or ""
            hashtags = re.findall(r"#\w+", desc)

            # Get best available author — prefer username over numeric ID
            def _clean_author(val):
                if not val:
                    return None
                val = str(val).strip()
                if val.startswith("@"):
                    val = val[1:]
                # Reject pure numeric IDs
                if val.isdigit():
                    return None
                return val or None

            # Prefer display name (uploader) over handle (channel) over numeric ID
            author = (
                _clean_author(info.get("uploader")) or
                _clean_author(info.get("channel")) or
                _clean_author(info.get("uploader_id")) or
                username
            )

            # Build clean title — use description caption if title is generic
            raw_title = info.get("title", "") or ""
            is_generic_title = not raw_title or raw_title.startswith("Video by") or raw_title.startswith("Post by")
            title = (
                (desc[:80].split("\n")[0] if desc and len(desc) > 10 and is_generic_title else None) or
                (raw_title if not is_generic_title else None) or
                f"Reel by @{author}"
            )

            likes    = info.get("like_count", 0) or 0
            comments = info.get("comment_count", 0) or 0
            # Instagram does not expose view/play count — known platform limitation
            views    = 0

            print(f"[instagram] fetched: author={author} likes={likes} comments={comments}")

            # Convert timestamp to upload_date if upload_date missing
            upload_date = info.get("upload_date")
            if not upload_date and info.get("timestamp"):
                from datetime import datetime, timezone
                upload_date = datetime.fromtimestamp(
                    info["timestamp"], tz=timezone.utc
                ).strftime("%Y%m%d")

            return {
                "title":          title,
                "author":         author,
                "follower_count": info.get("channel_follower_count"),
                "views":          views,
                "likes":          likes,
                "comments":       comments,
                "hashtags":       hashtags[:20],
                "upload_date":    upload_date,
                "duration":       info.get("duration", 0) or 0,
                "thumbnail":      info.get("thumbnail"),
                "description":    desc[:500],
            }
        except Exception as e:
            print(f"[instagram yt-dlp] failed: {e}")
            return {
                "title":   f"Instagram Reel by @{username}",
                "author":  username,
                "views": 0, "likes": 0, "comments": 0,
                "hashtags": [], "description": "",
                "note": "Stats unavailable — Instagram requires authentication for metrics",
            }

    def _make_instagram_transcript(self, metadata: dict) -> str:
        desc = metadata.get("description", "")
        if desc:
            return f"[Instagram Reel caption]: {desc}"
        return "[No caption available for this Instagram Reel.]"