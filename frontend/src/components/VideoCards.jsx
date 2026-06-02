import React from "react";

function fmtNum(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function EngBar({ rate, max = 20 }) {
  const pct = Math.min((rate / max) * 100, 100);
  const color = rate >= 6 ? "#22d3a5" : rate >= 3 ? "#f59e0b" : "#f87171";
  return (
    <div className="eng-bar-wrap">
      <div className="eng-bar-track">
        <div className="eng-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function VideoCard({ video, label }) {
  if (!video) return null;

  const isA = label === "A";
  const isInstagram = video.platform === "instagram";

  // For Instagram: comment rate = comments/likes*100 (since views unavailable)
  const commentRate = video.likes > 0
    ? ((video.comments / video.likes) * 100)
    : 0;

  const erLabel    = isInstagram ? "Comment Rate" : "Engagement Rate";
  const erValue    = isInstagram
    ? (video.likes > 0 ? commentRate.toFixed(2) + "%" : "N/A")
    : (video.engagement_rate != null ? video.engagement_rate.toFixed(2) + "%" : "—");
  const erBarRate  = isInstagram ? commentRate : (video.engagement_rate || 0);
  const erBarMax   = isInstagram ? 5 : 20; // comment rates are typically lower

  return (
    <div className={`video-card ${isA ? "card-a" : "card-b"}`}>
      <div className="card-label-row">
        <span className={`badge ${isA ? "badge-a" : "badge-b"}`}>{label}</span>
        <span className="card-platform">{video.platform}</span>
      </div>

      {video.thumbnail && (
        <div className="card-thumb-wrap">
          <img
            src={video.thumbnail}
            alt={video.title}
            className="card-thumb"
            onError={(e) => (e.target.style.display = "none")}
          />
        </div>
      )}

      <h3 className="card-title" title={video.title}>
        {video.title || "Untitled"}
      </h3>

      <div className="card-creator">
        <span className="creator-icon">@</span>
        <span>{video.creator && video.creator !== "Unknown" ? video.creator : "—"}</span>
        {video.follower_count != null && video.follower_count > 0 && (
          <span className="follower-pill">{fmtNum(video.follower_count)} followers</span>
        )}
      </div>

      <div className="card-stats">
        {isInstagram ? (
          <>
            <div className="stat">
              <span className="stat-val" style={{ color: "var(--muted)", fontSize: "11px" }}>N/A</span>
              <span className="stat-key">Views</span>
            </div>
            <div className="stat">
              <span className="stat-val">{fmtNum(video.likes)}</span>
              <span className="stat-key">Likes</span>
            </div>
            <div className="stat">
              <span className="stat-val">{fmtNum(video.comments)}</span>
              <span className="stat-key">Comments</span>
            </div>
          </>
        ) : (
          <>
            <div className="stat">
              <span className="stat-val">{fmtNum(video.views)}</span>
              <span className="stat-key">Views</span>
            </div>
            <div className="stat">
              <span className="stat-val">{fmtNum(video.likes)}</span>
              <span className="stat-key">Likes</span>
            </div>
            <div className="stat">
              <span className="stat-val">{fmtNum(video.comments)}</span>
              <span className="stat-key">Comments</span>
            </div>
          </>
        )}
      </div>

      <div className="card-er">
        <div className="er-row">
          <span className="er-label">{erLabel}</span>
          <span className="er-val">{erValue}</span>
        </div>
        <EngBar rate={erBarRate} max={erBarMax} />
        {isInstagram && (
          <p className="er-note">Views not exposed by Instagram · showing comments/likes ratio</p>
        )}
      </div>

      <div className="card-meta">
        {video.duration_str && video.duration_str !== "N/A" && (
          <span className="meta-pill">⏱ {video.duration_str}</span>
        )}
        {video.upload_date && (
          <span className="meta-pill">
            📅 {video.upload_date.length === 8
              ? `${video.upload_date.slice(0,4)}-${video.upload_date.slice(4,6)}-${video.upload_date.slice(6)}`
              : video.upload_date}
          </span>
        )}
      </div>

      {video.hashtags && video.hashtags.length > 0 && (
        <div className="card-hashtags">
          {video.hashtags.slice(0, 6).map((h, i) => (
            <span key={i} className="hashtag">
              {h.startsWith("#") ? h : `#${h}`}
            </span>
          ))}
          {video.hashtags.length > 6 && (
            <span className="hashtag hashtag-more">+{video.hashtags.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function VideoCards({ videos }) {
  return (
    <div className="video-cards-row">
      <VideoCard video={videos["A"]} label="A" />
      {videos["A"] && videos["B"] && <div className="cards-divider">VS</div>}
      <VideoCard video={videos["B"]} label="B" />
    </div>
  );
}