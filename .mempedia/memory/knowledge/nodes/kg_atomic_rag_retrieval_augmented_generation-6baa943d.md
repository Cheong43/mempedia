---
node_id: "kg_atomic_rag_retrieval_augmented_generation"
version: "f7c3d815cd3bc0bac041e1e511a91d04d897a2a637c7a9e5c38228363fe4a0cc"
timestamp: 1773124625
confidence: 0.9800
importance: 1.9000
title: "RAG (Retrieval-Augmented Generation)"
parents:
  - "8bbc9586aae59ded8a6fd1549e3b8b09247125075ead3521336e0e3ec257f80f"
---

# RAG (Retrieval-Augmented Generation)

## Summary

检索增强生成，结合外部知识库回答问题

## Details

流程：用户查询→向量化→向量数据库检索Top-K文档→拼接至Prompt→LLM生成。解决LLM知识截止和幻觉问题。适用于客服问答、企业知识库、专业领域问答。依赖检索质量，静态知识检索而非动态工具调用。

## Updated at

2026-03-10T06:37:04.621Z

## Type

atomic_knowledge
