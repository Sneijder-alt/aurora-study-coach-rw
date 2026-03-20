import re
from typing import List

_WORD_RE = re.compile(r"[a-zA-Z0-9']+")


def _tokenize(text: str) -> List[str]:
    return _WORD_RE.findall(text.lower())


class RAGIndex:
    """
    Lightweight lexical retrieval for low-resource environments.
    Stores documents in memory and returns the top k by token overlap.
    """

    def __init__(self, persist_dir: str = "./chroma_db"):
        self._docs: List[dict] = []

    def add_documents(self, docs: List[dict]):
        self._docs = list(docs)

    def count(self) -> int:
        return len(self._docs)

    def query(self, query: str, k: int = 5) -> str:
        if not self._docs:
            return ""
        q_tokens = set(_tokenize(query))
        if not q_tokens:
            return ""

        scored = []
        for doc in self._docs:
            text = doc.get("text", "")
            d_tokens = set(_tokenize(text))
            score = len(q_tokens & d_tokens)
            if score > 0:
                scored.append((score, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:k]

        chunks = []
        for _, d in top:
            meta = d.get("meta", {})
            title = meta.get("title", "Notes")
            chunks.append(f"### {title}\n{d.get('text','')}")

        return "\n\n".join(chunks)
