"""
Vectorization & Embedding Engine.

Monitors creation of new Documents and Communications. Upon creation:
1. Chunks the raw_ocr_text or transcript_body.
2. Generates high-dimensional vector embeddings using the active LLM provider
   (OpenAI, GitHub Copilot, Gemini, Ollama, LM Studio, or hash-based fallback).
3. Stores embeddings in ChromaDB with metadata tags (case_id, linked_source_id)
   to enable secure, case-isolated semantic search.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.services.llm_provider import (
    generate_embeddings as provider_generate_embeddings,
)

logger = get_logger("vectorization_service")

# ── Chunking Configuration ───────────────────────────────
CHUNK_SIZE = 800  # characters per chunk
CHUNK_OVERLAP = 200  # overlap between chunks


def _chunk_text(
    text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP
) -> list[str]:
    """
    Split text into overlapping chunks for embedding.
    Uses a sliding-window approach with configurable size and overlap.
    """
    if not text or not text.strip():
        return []

    text = text.strip()
    chunks: list[str] = []

    if len(text) <= chunk_size:
        return [text]

    start = 0
    while start < len(text):
        end = start + chunk_size

        # Try to break at a sentence boundary or newline
        if end < len(text):
            # Look backwards for a good break point
            for delimiter in ["\n\n", "\n", ". ", "! ", "? ", "; ", ", "]:
                break_pos = text.rfind(delimiter, start + chunk_size // 2, end)
                if break_pos != -1:
                    end = break_pos + len(delimiter)
                    break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap
        if start >= len(text):
            break

    logger.debug("text_chunked", total_chunks=len(chunks), text_length=len(text))
    return chunks


# ── Embedding Generation ─────────────────────────────────
async def _generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate vector embeddings using the active LLM provider.
    Delegates to the unified llm_provider abstraction which handles
    provider selection, fallback, and pseudo-embedding generation.
    """
    return await provider_generate_embeddings(texts)


# ── ChromaDB Client ──────────────────────────────────────
_chroma_client = None


def _get_chroma_client():
    """Get or create a ChromaDB client instance."""
    global _chroma_client
    if _chroma_client is None:
        try:
            import chromadb

            _chroma_client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
            )
            logger.info(
                "chromadb_client_initialized",
                host=settings.chroma_host,
                port=settings.chroma_port,
            )
        except Exception as exc:
            logger.warning(
                "chromadb_http_client_failed",
                detail="trying persistent local",
                error=str(exc),
            )
            import chromadb

            _chroma_client = chromadb.PersistentClient(path="./storage/chromadb")
            logger.info("chromadb_local_client_initialized")

    return _chroma_client


def _get_collection():
    """Get or create the legal documents collection in ChromaDB."""
    client = _get_chroma_client()
    collection = client.get_or_create_collection(
        name=settings.chroma_collection,
        metadata={"hnsw:space": "cosine"},
    )
    return collection


# ── Public API ───────────────────────────────────────────
async def vectorize_text(
    text: str,
    source_id: str,
    source_type: str,
    case_id: str,
) -> int:
    """
    Chunk text, generate embeddings, and store in ChromaDB.

    Args:
        text: The raw text to vectorize.
        source_id: UUID of the originating Document or Communication.
        source_type: "document" or "communication".
        case_id: UUID of the associated case (for case-isolated search).

    Returns:
        Number of chunks stored.
    """
    chunks = _chunk_text(text)
    if not chunks:
        logger.info("no_chunks_to_vectorize", source_id=source_id)
        return 0

    # Generate embeddings
    embeddings = await _generate_embeddings(chunks)

    # Prepare ChromaDB documents
    ids: list[str] = []
    metadatas: list[dict[str, Any]] = []

    for i, chunk in enumerate(chunks):
        chunk_id = f"{source_id}_chunk_{i}"
        ids.append(chunk_id)
        metadatas.append(
            {
                "source_id": source_id,
                "source_type": source_type,
                "case_id": case_id,
                "chunk_index": i,
                "total_chunks": len(chunks),
            }
        )

    # Upsert into ChromaDB
    try:
        collection = _get_collection()
        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas,
        )
        logger.info(
            "vectors_stored",
            source_id=source_id,
            source_type=source_type,
            chunks_stored=len(chunks),
        )
        return len(chunks)

    except Exception as exc:
        logger.error(
            "chromadb_upsert_failed",
            source_id=source_id,
            error=str(exc),
        )
        raise


async def semantic_search(
    query: str,
    case_id: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """
    Perform semantic search within a specific case's documents.
    Returns the top_k most similar chunks with metadata.
    """
    # Generate embedding for the query
    query_embedding = (await _generate_embeddings([query]))[0]

    try:
        collection = _get_collection()
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where={"case_id": case_id},
            include=["documents", "metadatas", "distances"],
        )

        search_results: list[dict[str, Any]] = []
        if results and results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                search_results.append(
                    {
                        "source_id": results["metadatas"][0][i].get("source_id", ""),
                        "source_type": results["metadatas"][0][i].get(
                            "source_type", ""
                        ),
                        "text_chunk": results["documents"][0][i]
                        if results["documents"]
                        else "",
                        "similarity_score": 1.0
                        - (results["distances"][0][i] if results["distances"] else 0),
                        "metadata": results["metadatas"][0][i],
                    }
                )

        logger.info(
            "semantic_search_complete",
            case_id=case_id,
            results_count=len(search_results),
        )
        return search_results

    except Exception as exc:
        logger.error("semantic_search_failed", case_id=case_id, error=str(exc))
        raise


def delete_vectors_by_source(source_id: str) -> None:
    """Delete all vector chunks associated with a source document or communication."""
    try:
        collection = _get_collection()
        collection.delete(where={"source_id": source_id})
        logger.info("vectors_deleted", source_id=source_id)
    except Exception as exc:
        logger.warning(
            "vector_delete_failed",
            source_id=source_id,
            error=str(exc),
        )
