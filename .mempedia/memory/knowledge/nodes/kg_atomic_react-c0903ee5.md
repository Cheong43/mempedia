---
node_id: "kg_atomic_react工作流程"
version: "c89570685dcecac8eee35867f3085cdae3c00c7918cbd6e9f35ae3d82e3742a4"
timestamp: 1773124228
confidence: 0.9800
importance: 1.9000
title: "ReAct工作流程"
parents:
  - "e99485165516c7e20e1dec0192cd409f60787803141abe6218cc4cef918af2e1"
---

# ReAct工作流程

## Summary

ReAct框架的三步循环机制：Thought(思考)→Action(行动)→Observation(观察)

## Details

Thought阶段分析当前情况并制定计划；Action阶段执行具体操作(如search、calculate)；Observation阶段接收行动结果。该循环持续进行直到得出最终答案。常用工具包括search(网络搜索)、calculate(数学计算)、read_file(文件读取)、write_file(文件写入)、run_shell(命令执行)等。

## Updated at

2026-03-10T06:30:27.661Z

## Type

atomic_knowledge
