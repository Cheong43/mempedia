---
node_id: "study_suna_kortix_project"
version: "e40875fba4791fdb2424b3034a60b5a63a90313ca46d26ff64a0874f5ddd4a19"
timestamp: 1773126491
confidence: 1.0000
importance: 1.0000
title: "Suna (Kortix) 项目学习笔记"
parents: []
---

# Suna (Kortix) 项目学习笔记

## 基本信息
- **项目名称**: Suna（由 Kortix AI 开发）
- **GitHub**: https://github.com/kortix-ai/suna
- **定位**: 完整的 AI Agent 开发平台
- **Stars**: 19,490 ⭐
- **Forks**: 3,370
- **主要语言**: TypeScript

## 核心功能
1. **Kortix Super Worker** - 旗舰通用 AI Worker
2. **浏览器自动化** - 网站导航、数据提取、表单填写
3. **文件管理** - 文档、电子表格、演示文稿、代码管理
4. **网页智能** - 网络爬取、搜索、数据提取与合成
5. **系统操作** - 命令行执行、DevOps 自动化
6. **API 集成** - 连接外部服务，跨平台工作流

## 技术架构
| 组件 | 技术 | 功能 |
|------|------|------|
| Backend API | Python/FastAPI | REST API、线程管理、Agent 编排 |
| Frontend | Next.js/React | 聊天界面、配置仪表板、工作流构建器 |
| Agent Runtime | Docker | 浏览器自动化、代码解释器、安全沙箱 |
| Database | Supabase | 认证、用户管理、配置、对话历史 |
| LLM Integration | LiteLLM | 支持 Anthropic、OpenAI、Groq 等多模型 |

## 使用场景
- 研究与分析
- 客户服务
- 内容创作
- 销售与营销
- 行业特定应用（医疗、金融、法律、教育）

## 快速开始
```bash
git clone https://github.com/kortix-ai/suna.git
cd suna
python setup.py  # 运行设置向导
python start.py start  # 启动所有服务
```

## 核心优势
1. 通用性强（Super Worker 模式）
2. 架构完整（前后端+运行时+数据库）
3. 企业级安全（Docker 隔离）
4. 多模型支持（通过 LiteLLM）

## 对标产品
- AutoGPT
- LangChain Agents
- Microsoft Copilot Studio
- Amazon Bedrock Agents

## 适用人群
- 开发者
- 企业 IT 团队
- AI 产品经理
- 有自动化需求的用户

---
*学习日期: 2026-03-10*
*数据来源: https://github.com/kortix-ai/suna*
