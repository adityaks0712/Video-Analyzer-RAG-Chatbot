# Quick test to find working embedding model
# Run: docker compose exec backend python /tmp/embedding_test.py
import os
import google.generativeai as genai

key = os.getenv("GEMINI_API_KEY", "")
genai.configure(api_key=key)

print("=== Available embedding models ===")
for m in genai.list_models():
    if "embed" in m.name.lower() or "embedding" in m.name.lower():
        print(f"  {m.name} | methods: {m.supported_generation_methods}")

print("\n=== Testing embedContent directly ===")
models_to_try = [
    "models/text-embedding-004",
    "models/embedding-001",
    "models/text-embedding-gecko-001",
]
for model_name in models_to_try:
    try:
        result = genai.embed_content(
            model=model_name,
            content="hello world",
            task_type="retrieval_document"
        )
        print(f"  ✓ {model_name} works! dim={len(result['embedding'])}")
    except Exception as e:
        print(f"  ✗ {model_name}: {e}")