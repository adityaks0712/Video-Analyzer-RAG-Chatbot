from pydantic import BaseModel
from typing import Optional, List


class VideoMetadata(BaseModel):
    video_id: str          # "A" or "B"
    url: str
    platform: str          # "youtube" or "instagram"
    title: str
    creator: str
    follower_count: Optional[int] = None
    views: int = 0
    likes: int = 0
    comments: int = 0
    engagement_rate: float = 0.0
    hashtags: List[str] = []
    upload_date: Optional[str] = None
    duration: Optional[float] = None   # seconds
    duration_str: Optional[str] = None
    transcript: str = ""
    thumbnail: Optional[str] = None
    description: Optional[str] = None


class ChatMessage(BaseModel):
    role: str   # "user" or "assistant"
    content: str


class AnalyzeRequest(BaseModel):
    url_a: str
    url_b: str


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"