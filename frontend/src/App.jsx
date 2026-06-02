import React, { useState, useCallback } from "react";
import VideoInput from "./components/VideoInput";
import VideoCards from "./components/VideoCards";
import ChatPanel from "./components/ChatPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import "./App.css";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

export default function App() {
  const [phase, setPhase] = useState("input");
  const [videos, setVideos] = useState({});
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");

  const handleAnalyze = useCallback(async (urlA, urlB) => {
    setError(null);
    setPhase("analyzing");
    setProgress("Fetching transcripts & metadata...");

    try {
      const res = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url_a: urlA, url_b: urlB }),
      });

      let data;
      try { data = await res.json(); }
      catch { throw new Error("Server returned an invalid response."); }

      if (!res.ok) {
        const detail = data?.detail;
        if (typeof detail === "string") throw new Error(detail);
        if (Array.isArray(detail)) throw new Error(detail.map(d => d.msg).join(", "));
        throw new Error(`Server error ${res.status}`);
      }

      const videos = data.videos || {};
      if (Object.keys(videos).length === 0)
        throw new Error("No videos could be processed. Check the URLs and try again.");

      setVideos(videos);
      setProgress("Embedding transcripts into vector DB...");
      await new Promise(r => setTimeout(r, 400));
      setPhase("ready");
    } catch (e) {
      setError(e.message);
      setPhase("input");
    }
  }, []);

  const handleReset = useCallback(async () => {
    await fetch(`${API}/api/reset`, { method: "DELETE" }).catch(() => {});
    setVideos({});
    setPhase("input");
    setError(null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <span className="logo-mark">◈</span>
          <h1 className="logo-text">REELIQ</h1>
          <span className="logo-sub">Video Intelligence Engine</span>
        </div>
        {phase === "ready" && (
          <button className="btn-reset" onClick={handleReset}>↩ New Analysis</button>
        )}
      </header>

      <main className="main-content">
        {phase === "input" && <VideoInput onAnalyze={handleAnalyze} error={error} />}

        {phase === "analyzing" && (
          <div className="analyzing-screen">
            <div className="spinner" />
            <p className="analyzing-text">{progress}</p>
            <p className="analyzing-sub">Pulling metadata · Chunking transcripts · Embedding vectors</p>
          </div>
        )}

        {phase === "ready" && (
          <div className="workspace">
            <VideoCards videos={videos} />
            <div className="bottom-panels">
              <ChatPanel apiBase={API} videos={videos} />
              <AnalyticsPanel videos={videos} apiBase={API} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}