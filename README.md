# REELIQ — RAG Video Intelligence Engine

A full-stack RAG chatbot that lets creators compare two social videos (YouTube + Instagram Reels), ask natural-language questions, and get streaming answers with source citations and memory.

---

---

## Tech Stack

| Layer       | Technology                            |
|-------------|---------------------------------------|
| Frontend    | React 18, CSS (no UI library)         |
| Backend     | FastAPI + Uvicorn                     |
| LLM         | Grok     |
| Embeddings  | HuggingFace `text-embedding-3-small`       |
| Vector DB   | Pinecone (Serverless)                 |
| RAG         | LangChain                             |
| Transcripts | youtube-transcript-api + yt-dlp       |
| Streaming   | Server-Sent Events (SSE)              |

---

## Quick Start

### 1. Clone & configure

```bash
git clone <repo>
cd rag-chatbot
cp backend/.env.example backend/.env
# Fill in all keys in backend/.env
```

### 2. Required API Keys (backend/.env)

```env
OPENAI_API_KEY=sk-...          # For embeddings (text-embedding-3-small)
ANTHROPIC_API_KEY=sk-ant-...   # For Claude chat (primary LLM)
PINECONE_API_KEY=pcsk_...      # Pinecone vector DB
PINECONE_INDEX=rag-video-chatbot
```

> **Pinecone setup**: Create a free account at pinecone.io → create a Serverless index (us-east-1, AWS, cosine, dim=1536) OR let the app auto-create it on first run.

### 3. Run with Docker Compose

```bash
docker-compose up --build
```

Open http://localhost:3000

### 4. Run locally (no Docker)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm start
```

---

## API Reference

### POST /api/analyze
Processes both video URLs: fetches metadata, pulls transcripts, chunks + embeds into Pinecone.

```json
{ "url_a": "https://youtube.com/watch?v=...", "url_b": "https://instagram.com/reel/..." }
```

Response includes per-video metadata + chunk counts.

### POST /api/chat/stream
SSE streaming endpoint. Returns citation events, then token-by-token text.

```json
{ "message": "Why did Video A get more engagement?", "session_id": "abc123" }
```

SSE event types:
- `{"type": "citations", "citations": [...]}` — emitted first
- `{"type": "token", "content": "..."}` — streamed tokens
- `{"type": "done"}` — stream complete

### GET /api/videos
Returns currently loaded video metadata.

### DELETE /api/reset
Clears vector index + conversation memory.

---

## Engagement Rate Formula

```
ER = (likes + comments) / views × 100
```

Benchmarks: >6% = excellent · 3–6% = good · 1–3% = average · <1% = low

---

## Transcript Sources (Priority Order)

**YouTube:**
1. `youtube-transcript-api` — fastest, no auth, uses auto-captions/manual captions
2. `yt-dlp` — fallback, also extracts all metadata
3. Whisper/AssemblyAI — for videos without captions (configure separately)

**Instagram:**
1. `yt-dlp` — extracts public Reels metadata + caption text
2. Audio download → Whisper transcription (add `USE_WHISPER=true` in .env)

---

## Adding Whisper/AssemblyAI

In `video_processor.py`, replace the fallback in `_fetch_instagram_transcript`:

```python
# Whisper (local)
import whisper, tempfile
model = whisper.load_model("base")
# download audio with yt-dlp to tmp file, then:
result = model.transcribe(tmp_audio_path)
return result["text"]

# AssemblyAI
import assemblyai as aai
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
transcriber = aai.Transcriber()
transcript = transcriber.transcribe(audio_url)
return transcript.text
```

---

## Chat Capabilities

| Question type | Example |
|---------------|---------|
| Engagement comparison | "Why did Video A outperform B?" |
| Metrics | "What's the engagement rate of each?" |
| Hook analysis | "Compare the first 5 seconds" |
| Creator info | "Who made Video B? Follower count?" |
| Strategy | "Suggest improvements for B based on A" |
| Free-form | Any question about content, style, themes |

All responses:
- **Stream** token-by-token via SSE
- **Cite** which video and which chunk they're drawing from
- **Remember** previous turns (10-turn window)
