import os
import asyncio
from typing import AsyncGenerator
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.schema import HumanMessage, AIMessage
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone, ServerlessSpec

GROQ_API_KEY     = os.getenv("GROQ_API_KEY", "")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX   = os.getenv("PINECONE_INDEX", "rag-video-chatbot")

# all-MiniLM-L6-v2 produces 384-dim vectors, fast and lightweight
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM   = 384


class SimpleMemory:
    def __init__(self, k=10):
        self.k = k
        self.messages: list = []

    def add_user_message(self, text: str):
        self.messages.append(HumanMessage(content=text))
        self._trim()

    def add_ai_message(self, text: str):
        self.messages.append(AIMessage(content=text))
        self._trim()

    def get_messages(self) -> list:
        return self.messages[-(self.k * 2):]

    def _trim(self):
        if len(self.messages) > self.k * 2:
            self.messages = self.messages[-(self.k * 2):]


class RAGEngine:
    def __init__(self):
        print("[embeddings] loading HuggingFace all-MiniLM-L6-v2...")
        self.embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        print("[embeddings] model loaded")
        self._init_pinecone()
        self._init_llm()
        self.memory: dict[str, SimpleMemory] = {}
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=400,
            chunk_overlap=60,
            separators=["\n\n", "\n", ". ", "! ", "? ", ", ", " "],
        )

    def _init_pinecone(self):
        pc = Pinecone(api_key=PINECONE_API_KEY)
        existing = [idx.name for idx in pc.list_indexes()]

        if PINECONE_INDEX in existing:
            idx_info = pc.describe_index(PINECONE_INDEX)
            if idx_info.dimension != EMBEDDING_DIM:
                print(f"[pinecone] dim mismatch {idx_info.dimension} != {EMBEDDING_DIM}, recreating")
                pc.delete_index(PINECONE_INDEX)
                existing = []

        if PINECONE_INDEX not in existing:
            print(f"[pinecone] creating index dim={EMBEDDING_DIM}")
            pc.create_index(
                name=PINECONE_INDEX,
                dimension=EMBEDDING_DIM,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region="us-east-1"),
            )

        self.pc_index = pc.Index(PINECONE_INDEX)
        self.vectorstore = PineconeVectorStore(
            index=self.pc_index,
            embedding=self.embeddings,
            text_key="text",
        )

    def _init_llm(self):
        self.llm = ChatGroq(
            api_key=GROQ_API_KEY,
            model="llama-3.3-70b-versatile",
            streaming=True,
            temperature=0.7,
        )

    def _get_memory(self, session_id: str) -> SimpleMemory:
        if session_id not in self.memory:
            self.memory[session_id] = SimpleMemory(k=10)
        return self.memory[session_id]

    def clear_memory(self):
        self.memory.clear()

    async def clear_index(self):
        try:
            self.pc_index.delete(delete_all=True)
        except Exception:
            pass

    async def index_video(self, metadata, video_id: str) -> int:
        loop = asyncio.get_event_loop()

        meta_text = (
            f"Video {video_id} | Platform: {metadata.platform} | "
            f"Title: {metadata.title} | Creator: {metadata.creator} | "
            f"Followers: {metadata.follower_count or 'N/A'} | "
            f"Views: {metadata.views:,} | Likes: {metadata.likes:,} | "
            f"Comments: {metadata.comments:,} | "
            f"Engagement Rate: {metadata.engagement_rate:.4f}% | "
            f"Duration: {metadata.duration_str or 'N/A'} | "
            f"Upload Date: {metadata.upload_date or 'N/A'} | "
            f"Hashtags: {' '.join(metadata.hashtags[:10]) or 'none'}"
        )

        await loop.run_in_executor(
            None,
            lambda: self.vectorstore.add_texts(
                texts=[meta_text],
                metadatas=[{
                    "video_id": video_id,
                    "chunk_type": "metadata",
                    "chunk_index": 0,
                    "source": f"Video {video_id} metadata",
                }],
                ids=[f"video_{video_id}_metadata"],
            )
        )

        if not metadata.transcript or metadata.transcript.startswith("["):
            return 1

        chunks = self.splitter.split_text(metadata.transcript)
        texts, metas, ids = [], [], []

        for i, chunk in enumerate(chunks):
            enriched = f"[Video {video_id} | {metadata.title} | chunk {i+1}/{len(chunks)}]\n{chunk}"
            texts.append(enriched)
            metas.append({
                "video_id": video_id,
                "chunk_type": "transcript",
                "chunk_index": i + 1,
                "source": f"Video {video_id} transcript, chunk {i+1}",
                "original_text": chunk[:200],
            })
            ids.append(f"video_{video_id}_chunk_{i}")

        batch_size = 50
        for start in range(0, len(texts), batch_size):
            bt = texts[start:start + batch_size]
            bm = metas[start:start + batch_size]
            bi = ids[start:start + batch_size]
            await loop.run_in_executor(
                None,
                lambda bt=bt, bm=bm, bi=bi: self.vectorstore.add_texts(
                    texts=bt, metadatas=bm, ids=bi
                )
            )

        return len(chunks) + 1

    async def chat_stream(
        self,
        question: str,
        session_id: str,
        video_metadata: dict,
    ) -> AsyncGenerator[dict, None]:

        memory = self._get_memory(session_id)
        loop   = asyncio.get_event_loop()

        # 1. Retrieve relevant chunks
        docs = await loop.run_in_executor(
            None,
            lambda: self.vectorstore.similarity_search_with_score(question, k=6)
        )

        context_parts = []
        citations = []
        seen_sources = set()

        for doc, score in docs:
            if score < 0.3:
                continue
            meta   = doc.metadata
            source = meta.get("source", "Unknown source")
            vid_id = meta.get("video_id", "?")
            ctype  = meta.get("chunk_type", "transcript")

            if source not in seen_sources:
                seen_sources.add(source)
                citations.append({
                    "source": source,
                    "video_id": vid_id,
                    "chunk_type": ctype,
                    "score": round(float(score), 3),
                })

            context_parts.append(f"[{source}]:\n{doc.page_content}")

        context = "\n\n---\n\n".join(context_parts) if context_parts else "No relevant context found."

        # 2. Metadata summary
        meta_summary = []
        for vid_id, meta in video_metadata.items():
            meta_summary.append(
                f"Video {vid_id}: '{meta.get('title','?')}' by {meta.get('creator','?')} | "
                f"Views={meta.get('views',0):,} | Likes={meta.get('likes',0):,} | "
                f"Comments={meta.get('comments',0):,} | "
                f"ER={meta.get('engagement_rate',0):.4f}% | "
                f"Followers={meta.get('follower_count','N/A')} | "
                f"Duration={meta.get('duration_str','N/A')} | "
                f"Platform={meta.get('platform','?')}"
            )
        meta_block = "\n".join(meta_summary) or "No video metadata available."

        # 3. System prompt
        from langchain.schema import SystemMessage
        system_prompt = f"""You are a social media analytics expert and content strategist helping creators understand their video performance.

VIDEO METADATA:
{meta_block}

RETRIEVED CONTEXT (from transcripts & metadata):
{context}

INSTRUCTIONS:
- Answer questions about both videos using the context and metadata above.
- When referencing specific information, cite the source in brackets like [Video A transcript, chunk 3].
- For engagement rate questions, use the formula: (likes + comments) / views x 100.
- For improvement suggestions, be specific and actionable.
- For hook comparisons, reference the first lines of transcripts.
- Keep responses concise but thorough. Use bullet points for comparisons.
- If data is missing or transcripts are unavailable, say so clearly."""

        # 4. Build messages with memory (Groq supports SystemMessage natively)
        history = memory.get_messages()
        messages = [SystemMessage(content=system_prompt)] + history + [HumanMessage(content=question)]

        # 5. Stream
        full_response = ""

        if citations:
            yield {"type": "citations", "citations": citations}

        async for chunk in self.llm.astream(messages):
            token = chunk.content if hasattr(chunk, "content") else str(chunk)
            if token:
                full_response += token
                yield {"type": "token", "content": token}

        memory.add_user_message(question)
        memory.add_ai_message(full_response)

        yield {"type": "done", "full_response": full_response}