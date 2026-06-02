import React, { useState, useEffect, useRef } from "react";

function fmtNum(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function MetricBar({ label, valA, valB, maxVal, colorA, colorB, suffix = "" }) {
  const pctA = maxVal > 0 ? (valA / maxVal) * 100 : 0;
  const pctB = maxVal > 0 ? (valB / maxVal) * 100 : 0;
  return (
    <div className="metric-bar-row">
      <div className="metric-bar-label">{label}</div>
      <div className="metric-bar-tracks">
        <div className="metric-bar-track-wrap">
          <div className="metric-bar-val" style={{ color: colorA }}>
            {typeof valA === "number" ? (Number.isInteger(valA) ? fmtNum(valA) : valA.toFixed(2) + suffix) : valA}
          </div>
          <div className="metric-bar-track">
            <div className="metric-bar-fill" style={{ width: `${pctA}%`, background: colorA }} />
          </div>
        </div>
        <div className="metric-bar-track-wrap">
          <div className="metric-bar-val" style={{ color: colorB }}>
            {typeof valB === "number" ? (Number.isInteger(valB) ? fmtNum(valB) : valB.toFixed(2) + suffix) : valB}
          </div>
          <div className="metric-bar-track">
            <div className="metric-bar-fill" style={{ width: `${pctB}%`, background: colorB }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RadarChart({ videos }) {
  const canvasRef = useRef(null);
  const A = videos["A"];
  const B = videos["B"];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !A) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 28;

    ctx.clearRect(0, 0, W, H);

    const labels = ["Views", "Likes", "Comments", "Eng Rate", "Duration"];

    const maxViews    = Math.max(A?.views || 0, B?.views || 0, 1);
    const maxLikes    = Math.max(A?.likes || 0, B?.likes || 0, 1);
    const maxComments = Math.max(A?.comments || 0, B?.comments || 0, 1);
    const maxER       = Math.max(A?.engagement_rate || 0, B?.engagement_rate || 0, 0.01);
    const maxDur      = Math.max(A?.duration || 0, B?.duration || 0, 1);

    const normalize = (vid) => vid ? [
      vid.views / maxViews,
      vid.likes / maxLikes,
      vid.comments / maxComments,
      (vid.engagement_rate || 0) / maxER,
      (vid.duration || 0) / maxDur,
    ] : [];

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const gridColor  = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
    const labelColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";

    const n = labels.length;
    const step = (Math.PI * 2) / n;
    const startAngle = -Math.PI / 2;

    // Grid rings
    [0.25, 0.5, 0.75, 1].forEach(frac => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = startAngle + i * step;
        const x = cx + Math.cos(a) * r * frac;
        const y = cy + Math.sin(a) * r * frac;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // Spokes
    for (let i = 0; i < n; i++) {
      const a = startAngle + i * step;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Labels
    ctx.font = "10px sans-serif";
    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const a = startAngle + i * step;
      const lx = cx + Math.cos(a) * (r + 16);
      const ly = cy + Math.sin(a) * (r + 16);
      ctx.fillText(labels[i], lx, ly);
    }

    // Draw polygon for a video
    const drawPoly = (vals, color) => {
      if (!vals.length) return;
      ctx.beginPath();
      vals.forEach((v, i) => {
        const a = startAngle + i * step;
        const x = cx + Math.cos(a) * r * v;
        const y = cy + Math.sin(a) * r * v;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color.replace(")", ", 0.12)").replace("rgb", "rgba");
      ctx.fill();
    };

    drawPoly(normalize(A), "#3b82f6");
    if (B) drawPoly(normalize(B), "#a855f7");

  }, [videos]);

  return (
    <div className="radar-wrap">
      <div className="legend-row">
        <span className="legend-dot" style={{ background: "#3b82f6" }} /> <span>Video A</span>
        {B && <><span className="legend-dot" style={{ background: "#a855f7" }} /> <span>Video B</span></>}
      </div>
      <canvas ref={canvasRef} width={220} height={220} className="radar-canvas" />
    </div>
  );
}

function ModelMetrics({ apiBase }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const start = Date.now();
    fetch(`${apiBase}/health`)
      .then(r => r.json())
      .then(data => {
        const latency = Date.now() - start;
        setMetrics({
          latency,
          status: data.status,
          uptime: Math.floor((Date.now() / 1000 - (data.timestamp || Date.now() / 1000))),
          model: "llama-3.3-70b",
          provider: "Groq",
          embeddings: "MiniLM-L6-v2",
          vectorDB: "Pinecone",
        });
        setLoading(false);
      })
      .catch(() => {
        setMetrics({ latency: null, status: "error" });
        setLoading(false);
      });
  }, [apiBase]);

  if (loading) return <div className="metrics-loading">Checking model status...</div>;

  return (
    <div className="model-metrics">
      <div className="metrics-grid">
        <div className="mmetric">
          <span className="mm-val" style={{ color: metrics.latency < 200 ? "#22d3a5" : metrics.latency < 500 ? "#f59e0b" : "#f87171" }}>
            {metrics.latency ? `${metrics.latency}ms` : "—"}
          </span>
          <span className="mm-key">API Latency</span>
        </div>
        <div className="mmetric">
          <span className="mm-val" style={{ color: metrics.status === "ok" ? "#22d3a5" : "#f87171" }}>
            {metrics.status === "ok" ? "Online" : "Error"}
          </span>
          <span className="mm-key">Backend</span>
        </div>
        <div className="mmetric">
          <span className="mm-val">Groq</span>
          <span className="mm-key">LLM Provider</span>
        </div>
        <div className="mmetric">
          <span className="mm-val" style={{ fontSize: "10px" }}>llama-3.3-70b</span>
          <span className="mm-key">Model</span>
        </div>
        <div className="mmetric">
          <span className="mm-val" style={{ fontSize: "10px" }}>MiniLM-L6</span>
          <span className="mm-key">Embeddings</span>
        </div>
        <div className="mmetric">
          <span className="mm-val">Pinecone</span>
          <span className="mm-key">Vector DB</span>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPanel({ videos, apiBase }) {
  const A = videos["A"];
  const B = videos["B"];

  const maxViews    = Math.max(A?.views || 0, B?.views || 0, 1);
  const maxLikes    = Math.max(A?.likes || 0, B?.likes || 0, 1);
  const maxComments = Math.max(A?.comments || 0, B?.comments || 0, 1);
  const maxER       = Math.max(A?.engagement_rate || 0, B?.engagement_rate || 0, 0.01);

  const [tab, setTab] = useState("compare");

  return (
    <div className="analytics-panel">
      <div className="analytics-header">
        <span className="analytics-title">Analytics</span>
        <div className="analytics-tabs">
          <button className={`atab ${tab === "compare" ? "atab-active" : ""}`} onClick={() => setTab("compare")}>Compare</button>
          <button className={`atab ${tab === "model" ? "atab-active" : ""}`} onClick={() => setTab("model")}>Model</button>
        </div>
      </div>

      {tab === "compare" && (
        <div className="analytics-body">
          <RadarChart videos={videos} />

          <div className="metrics-section">
            <div className="metrics-legend">
              <span className="legend-dot" style={{ background: "#3b82f6" }} /> A &nbsp;&nbsp;
              <span className="legend-dot" style={{ background: "#a855f7" }} /> B
            </div>

            <MetricBar
              label="Views"
              valA={A?.views || 0}
              valB={B?.views || 0}
              maxVal={maxViews}
              colorA="#3b82f6"
              colorB="#a855f7"
            />
            <MetricBar
              label="Likes"
              valA={A?.likes || 0}
              valB={B?.likes || 0}
              maxVal={maxLikes}
              colorA="#3b82f6"
              colorB="#a855f7"
            />
            <MetricBar
              label="Comments"
              valA={A?.comments || 0}
              valB={B?.comments || 0}
              maxVal={maxComments}
              colorA="#3b82f6"
              colorB="#a855f7"
            />
            <MetricBar
              label="Eng Rate"
              valA={A?.engagement_rate || 0}
              valB={B?.engagement_rate || 0}
              maxVal={maxER}
              colorA="#3b82f6"
              colorB="#a855f7"
              suffix="%"
            />
          </div>

          {A && B && (
            <div className="winner-banner">
              {(A.engagement_rate || 0) > (B.engagement_rate || 0) ? (
                <><span className="badge badge-a">A</span> leads with {((A.engagement_rate || 0) - (B.engagement_rate || 0)).toFixed(2)}% higher ER</>
              ) : (A.engagement_rate || 0) < (B.engagement_rate || 0) ? (
                <><span className="badge badge-b">B</span> leads with {((B.engagement_rate || 0) - (A.engagement_rate || 0)).toFixed(2)}% higher ER</>
              ) : (
                <>Both videos have equal engagement rates</>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "model" && (
        <div className="analytics-body">
          <ModelMetrics apiBase={apiBase} />
          <div className="stack-info">
            <div className="stack-row"><span className="stack-key">Architecture</span><span className="stack-val">RAG + Vector Search</span></div>
            <div className="stack-row"><span className="stack-key">LLM</span><span className="stack-val">Llama 3.3 70B (Groq)</span></div>
            <div className="stack-row"><span className="stack-key">Embeddings</span><span className="stack-val">all-MiniLM-L6-v2 (384d)</span></div>
            <div className="stack-row"><span className="stack-key">Vector DB</span><span className="stack-val">Pinecone (cosine sim)</span></div>
            <div className="stack-row"><span className="stack-key">Chunk size</span><span className="stack-val">400 tokens / 60 overlap</span></div>
            <div className="stack-row"><span className="stack-key">Top-K retrieval</span><span className="stack-val">6 chunks per query</span></div>
            <div className="stack-row"><span className="stack-key">Memory window</span><span className="stack-val">10 turns</span></div>
            <div className="stack-row"><span className="stack-key">Streaming</span><span className="stack-val">SSE token-by-token</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
