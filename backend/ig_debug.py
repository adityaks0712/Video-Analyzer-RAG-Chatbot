# Drop this in backend/ and run:
# docker compose exec backend python ig_debug.py <instagram_reel_url>
import sys, os
import yt_dlp

url = sys.argv[1] if len(sys.argv) > 1 else "https://www.instagram.com/reel/test/"
cookies_path = "/app/instagram_cookies.txt"

ydl_opts = {
    "quiet": False,
    "skip_download": True,
    "cookiefile": cookies_path if os.path.exists(cookies_path) else None,
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    fields = [
        "view_count", "play_count", "like_count",
        "comment_count", "repost_count", "uploader",
        "uploader_id", "channel", "channel_follower_count",
        "duration", "title", "description"
    ]
    print("\n=== Available fields ===")
    for f in fields:
        val = info.get(f)
        print(f"  {f}: {val}")

    print("\n=== All non-null fields ===")
    for k, v in info.items():
        if v is not None and not isinstance(v, (dict, list)):
            print(f"  {k}: {v}")
