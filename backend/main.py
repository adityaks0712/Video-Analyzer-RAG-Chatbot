import os
import asyncio
import json
import re
import time
from typing import AsyncGenerator, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

from video_processor import VideoProcessor
from rag_engine import RAGEngine
from models import VideoMetadata, ChatMessage, AnalyzeRequest, ChatRequest

app = FastAPI(title="RAG Video Chatbot", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

video_processor = VideoProcessor()
rag_engine = RAGEngine()

sessions: dict = {}
video_store: dict = {}


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


@app.post("/api/analyze")
async def analyze_videos(request: AnalyzeRequest):
    results = {}
    errors = {}

    for video_id, url in [("A", request.url_a), ("B", request.url_b)]:
        try:
            metadata = await video_processor.process_video(url, video_id)
            video_store[video_id] = metadata
            chunk_count = await rag_engine.index_video(metadata, video_id)
            results[video_id] = {
                "metadata": metadata.dict(),
                "chunks_indexed": chunk_count,
                "status": "success"
            }
        except Exception as e:
            print(f"[analyze] Video {video_id} failed: {e}")
            errors[video_id] = str(e)
            results[video_id] = {"status": "error", "error": str(e)}

    videos = {
        k: v["metadata"]
        for k, v in results.items()
        if v.get("status") == "success"
    }

    # Succeed if at least one video processed
    if len(videos) == 0:
        raise HTTPException(
            status_code=422,
            detail=f"No videos could be processed. Errors: {errors}"
        )

    return {
        "results": results,
        "errors": errors,
        "ready": True,
        "videos": videos
    }


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    async def generate() -> AsyncGenerator[str, None]:
        try:
            async for chunk in rag_engine.chat_stream(
                question=request.message,
                session_id=request.session_id,
                video_metadata={k: v.dict() for k, v in video_store.items()}
            ):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/videos")
async def get_videos():
    return {k: v.dict() for k, v in video_store.items()}


@app.delete("/api/reset")
async def reset():
    video_store.clear()
    rag_engine.clear_memory()
    await rag_engine.clear_index()
    return {"status": "reset"}