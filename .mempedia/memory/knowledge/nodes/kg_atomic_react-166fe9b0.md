---
node_id: "kg_atomic_react实现模板"
version: "fa99ecfb944eaf588399a6630c1ff92b2c2bcea4c4f104333394982314af97a3"
timestamp: 1773124228
confidence: 0.9800
importance: 1.9000
title: "ReAct实现模板"
parents:
  - "cd5552c516f7f2c0c2fed5e0981d820606f35ac0e3313636d6368cfb90b1301e"
---

# ReAct实现模板

## Summary

实现ReAct框架的基础Prompt结构和代码组织方式

## Details

基础Prompt模板要求AI遵循特定格式：先输出Thought(推理过程)，再输出Action(操作类型及参数)，然后接收Observation(结果)，循环往复直至使用finish动作输出最终答案。实现时需要定义工具集(tool set)、解析器(parser)用于提取Thought和Action、执行器(executor)用于调用工具，以及循环控制器管理迭代次数和终止条件。

## Updated at

2026-03-10T06:30:27.661Z

## Type

atomic_knowledge
