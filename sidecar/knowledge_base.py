"""Local knowledge base -- chunk storage and FTS5 retrieval.

Each project gets its own SQLite DB with FTS5 for semantic search.
Documents are split into chunks (~500 tokens) and indexed.
"""
from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path
from typing import List
from dataclasses import dataclass

KB_DIR = Path.home() / ".bitidea-desktop" / "knowledge"


@dataclass
class DocChunk:
    id: str
    doc_id: str
    doc_name: str
    content: str
    chunk_index: int
    score: float = 0.0


@dataclass
class Document:
    id: str
    name: str
    path: str
    chunk_count: int
    created_at: int


def _db_path(project_id: str) -> Path:
    KB_DIR.mkdir(parents=True, exist_ok=True)
    return KB_DIR / f"{project_id}.db"


def _get_conn(project_id: str) -> sqlite3.Connection:
    path = _db_path(project_id)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # Create tables if needed
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            path        TEXT NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
            id          TEXT PRIMARY KEY,
            doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            content     TEXT NOT NULL,
            chunk_index INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            chunk_id UNINDEXED,
            doc_id UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 2'
        );
    """)
    return conn


def _chunk_text(text: str, max_chars: int = 1500, overlap: int = 200) -> List[str]:
    """Split text into overlapping chunks by paragraph boundaries."""
    paragraphs = re.split(r'\n\s*\n', text)
    chunks: List[str] = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) + 2 > max_chars and current:
            chunks.append(current.strip())
            # Keep overlap from end of current chunk
            if overlap > 0 and len(current) > overlap:
                current = current[-overlap:] + "\n\n" + para
            else:
                current = para
        else:
            current = (current + "\n\n" + para).strip() if current else para
    if current.strip():
        chunks.append(current.strip())
    return chunks if chunks else [text[:max_chars]]


def _doc_id(path: str) -> str:
    return hashlib.sha256(path.encode()).hexdigest()[:16]


def _chunk_id(doc_id: str, index: int) -> str:
    return f"{doc_id}_{index}"


def add_document(project_id: str, name: str, path: str, content: str) -> Document:
    """Index a document into the project's knowledge base."""
    conn = _get_conn(project_id)
    doc_id = _doc_id(path)
    now = int(__import__("time").time() * 1000)

    # Remove existing doc if re-importing
    conn.execute("DELETE FROM chunks_fts WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))

    chunks = _chunk_text(content)
    conn.execute(
        "INSERT INTO documents (id, name, path, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)",
        (doc_id, name, path, len(chunks), now),
    )
    for i, chunk in enumerate(chunks):
        cid = _chunk_id(doc_id, i)
        conn.execute(
            "INSERT INTO chunks (id, doc_id, content, chunk_index) VALUES (?, ?, ?, ?)",
            (cid, doc_id, chunk, i),
        )
        conn.execute(
            "INSERT INTO chunks_fts (content, chunk_id, doc_id) VALUES (?, ?, ?)",
            (chunk, cid, doc_id),
        )
    conn.commit()
    conn.close()
    return Document(id=doc_id, name=name, path=path, chunk_count=len(chunks), created_at=now)


def remove_document(project_id: str, doc_id: str) -> None:
    conn = _get_conn(project_id)
    conn.execute("DELETE FROM chunks_fts WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()


def list_documents(project_id: str) -> List[Document]:
    conn = _get_conn(project_id)
    rows = conn.execute(
        "SELECT id, name, path, chunk_count, created_at FROM documents ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [Document(id=r[0], name=r[1], path=r[2], chunk_count=r[3], created_at=r[4]) for r in rows]


def search_chunks(project_id: str, query: str, limit: int = 5) -> List[DocChunk]:
    """FTS5 search for relevant chunks."""
    conn = _get_conn(project_id)
    try:
        # Use BM25 ranking
        rows = conn.execute(
            """
            SELECT c.id, c.doc_id, d.name, c.content, c.chunk_index, rank
            FROM chunks_fts f
            JOIN chunks c ON f.chunk_id = c.id
            JOIN documents d ON c.doc_id = d.id
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit),
        ).fetchall()
    except sqlite3.OperationalError:
        # FTS5 MATCH can fail on malformed queries — return empty
        rows = []
    conn.close()
    return [
        DocChunk(id=r[0], doc_id=r[1], doc_name=r[2], content=r[3], chunk_index=r[4], score=abs(r[5]))
        for r in rows
    ]
