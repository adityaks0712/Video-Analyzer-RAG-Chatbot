import React, { useState } from "react";

const EXAMPLE_QUERIES = [
  "Why did Video A get more engagement than Video B?",
  "What's the engagement rate of each video?",
  "Compare the hooks in the first 5 seconds",
  "Who's the creator of Video B and what's their follower count?",
  "Suggest improvements for B based on what worked in A",
];

export default function VideoInput({ onAnalyze, error }) {
  const [urlA, setUrlA] = useState("");
  const [urlB, setUrlB] = useState("");
  const [loading, setLoading] = useState(false);

  const validate = (url) => {
    return (
      url.includes("youtube.com") ||
      url.includes("youtu.be") ||
      url.includes("instagram.com")
    );
  };

  const handleSubmit = async () => {
    if (!validate(urlA) || !validate(urlB)) return;
    setLoading(true);
    await onAnalyze(urlA.trim(), urlB.trim());
    setLoading(false);
  };

  const canSubmit = validate(urlA) && validate(urlB) && !loading;

  return (
    <div className="input-page">
      <div className="input-hero">
        <p className="hero-eyebrow">RAG-powered video analytics</p>
        <h2 className="hero-title">Compare. Analyze. Improve.</h2>
        <p className="hero-desc">
          Drop two social videos — YouTube or Instagram Reels — and ask anything
          about their performance, content, and strategy.
        </p>
      </div>

      <div className="input-card">
        <div className="url-row">
          <div className="url-field">
            <label className="url-label">
              <span className="badge badge-a">A</span> Video A
            </label>
            <input
              className="url-input"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={urlA}
              onChange={(e) => setUrlA(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && handleSubmit()}
            />
            <span className="url-hint">YouTube or Instagram Reel</span>
          </div>

          <div className="url-vs">VS</div>

          <div className="url-field">
            <label className="url-label">
              <span className="badge badge-b">B</span> Video B
            </label>
            <input
              className="url-input"
              type="url"
              placeholder="https://instagram.com/reel/..."
              value={urlB}
              onChange={(e) => setUrlB(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && handleSubmit()}
            />
            <span className="url-hint">YouTube or Instagram Reel</span>
          </div>
        </div>

        {error && <div className="error-banner">⚠ {error}</div>}

        <button
          className="btn-analyze"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? "Analyzing…" : "Analyze Videos →"}
        </button>
      </div>

      <div className="example-queries">
        <p className="eq-label">You'll be able to ask things like:</p>
        <div className="eq-list">
          {EXAMPLE_QUERIES.map((q, i) => (
            <div key={i} className="eq-item">
              <span className="eq-quote">❝</span> {q}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
