"""步骤3 索引构建工具：将解析后的论文加入混合检索向量库"""
from __future__ import annotations

import asyncio
import logging
import time
from threading import Lock
from typing import TYPE_CHECKING

from backend.tools.base import Tool

if TYPE_CHECKING:
    from backend.models.schemas import ParsedPaper

logger = logging.getLogger(__name__)

# 模块级单例：懒加载，避免导入即触发重型依赖（Embedder/Chroma/BM25）
_hybrid_searcher = None
_searcher_lock = Lock()
_index_write_lock = Lock()


def _get_searcher():
    """懒加载模块级 HybridSearcher 单例。

    供 build_vector_index 与 hybrid_search_tool 共享同一实例，
    保证索引写入与检索读取状态一致。
    """
    global _hybrid_searcher
    with _searcher_lock:
        if _hybrid_searcher is not None:
            return _hybrid_searcher
        _t0 = time.perf_counter()
        from backend.rag.hybrid_search import HybridSearcher

        _hybrid_searcher = HybridSearcher()
        logger.info(
            "[_get_searcher] HybridSearcher 实例化完成: %.3fs（含 Embedder/ChromaStore/BM25Store 构造，未加载模型）",
            time.perf_counter() - _t0,
        )
        return _hybrid_searcher


def _get_vector_store():
    """获取底层 ChromaStore（用于去重查询与删除）"""
    searcher = _get_searcher()
    return searcher.vector_store


def is_indexed(paper_path: str) -> bool:
    """检查指定论文是否已索引（Chroma 中已有该 paper_path 的 chunks）

    Args:
        paper_path: 论文文件路径

    Returns:
        是否已存在 chunks
    """
    try:
        _t0 = time.perf_counter()
        store = _get_vector_store()
        _t_get_store = time.perf_counter()
        store._ensure()  # 首次调用会初始化 chromadb client
        _t_ensure = time.perf_counter()
        collection = store._collection
        result = collection.get(where={"paper_path": paper_path}, limit=1)
        _t_query = time.perf_counter()
        ids = result.get("ids", []) if result else []
        logger.info(
            "[is_indexed] %s: get_store=%.3fs ensure=%.3fs query=%.3fs total=%.3fs result=%s",
            paper_path, _t_get_store - _t0, _t_ensure - _t_get_store,
            _t_query - _t_ensure, _t_query - _t0, len(ids) > 0,
        )
        return len(ids) > 0
    except Exception as exc:
        logger.warning("查询索引状态失败: %s", exc)
        return False


def delete_paper_chunks(paper_path: str) -> int:
    """删除指定论文在 Chroma 中的所有 chunks

    Args:
        paper_path: 论文文件路径

    Returns:
        删除的 chunk 数量
    """
    try:
        with _index_write_lock:
            store = _get_vector_store()
            store._ensure()
            collection = store._collection
            result = collection.get(where={"paper_path": paper_path})
            ids = result.get("ids", []) if result else []
            if ids:
                collection.delete(ids=ids)
                logger.info("已删除论文 %s 的 %d 个 chunks", paper_path, len(ids))
            return len(ids)
    except Exception as exc:
        logger.warning("删除论文 chunks 失败: %s", exc)
        return 0


def _add_paper_if_missing(paper: ParsedPaper) -> bool:
    with _index_write_lock:
        if paper.path and is_indexed(paper.path):
            return False
        _get_searcher().add_paper(paper)
        return True


async def build_vector_index(papers_json: list[dict]) -> dict:
    """将已解析论文列表加入向量库与 BM25 库。

    对每篇论文先检查是否已索引，已索引则跳过（去重）。

    Args:
        papers_json: 已解析论文列表，每项含 path/title/sections

    Returns:
        {"indexed_count": N, "skipped_count": M, "status": "done"}
    """
    from backend.models.schemas import ParsedPaper, Section

    _t_fn_start = time.perf_counter()
    logger.info("[build_vector_index] 入口: %d papers", len(papers_json))

    indexed = 0
    skipped = 0
    for paper_dict in papers_json:
        try:
            paper_path = paper_dict.get("path", "")
            _t_paper0 = time.perf_counter()

            sections = [
                Section(
                    heading=s.get("heading", ""),
                    content=s.get("content", ""),
                    figure_captions=s.get("figure_captions", []),
                )
                for s in paper_dict.get("sections", [])
            ]
            paper = ParsedPaper(
                path=paper_path,
                title=paper_dict.get("title", ""),
                sections=sections,
            )
            _t_construct = time.perf_counter()
            logger.info(
                "[build_vector_index] %s: paper_construct=%.3fs sections=%d",
                paper_path, _t_construct - _t_paper0, len(sections),
            )
            if not await asyncio.to_thread(_add_paper_if_missing, paper):
                skipped += 1
                continue
            _t_add = time.perf_counter()
            logger.info(
                "[build_vector_index] %s: async_add_paper=%.3fs (paper total=%.3fs)",
                paper_path, _t_add - _t_construct, _t_add - _t_paper0,
            )
            indexed += 1
        except Exception as exc:
            # 单篇失败隔离，继续处理其余论文
            logger.exception("[build_vector_index] 单篇索引失败: %s", exc)
            continue
    _t_done = time.perf_counter()
    logger.info(
        "[build_vector_index] 完成: indexed=%d skipped=%d total=%.3fs",
        indexed, skipped, _t_done - _t_fn_start,
    )
    return {"indexed_count": indexed, "skipped_count": skipped, "status": "done"}


# ---------- Tool 定义 ----------

_PARAMETERS = {
    "type": "object",
    "properties": {
        "papers_json": {
            "type": "array",
            "description": "已解析论文列表，每项含 path/title/sections",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "title": {"type": "string"},
                    "sections": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "heading": {"type": "string"},
                                "content": {"type": "string"},
                                "figure_captions": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
        }
    },
    "required": ["papers_json"],
}

build_vector_index_tool = Tool(
    name="build_vector_index",
    description=(
        "步骤3：将已解析论文列表加入向量库与 BM25 库，支持后续混合搜索。"
        "返回 {indexed_count, status}。"
    ),
    parameters=_PARAMETERS,
    func=build_vector_index,
)
