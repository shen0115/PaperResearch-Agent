# PaperResearch-Agent 论文科研智能体

面向论文阅读与研究构思的 Agent 应用。批量上传 PDF，抽取论文结构，结合混合检索提出候选研究空白，再生成创新方向、实验方案和研究报告。

## 工作流程

```text
上传 PDF → 解析文本 → 结构化抽取 → 原文分块与索引
       → 跨论文研究空白分析 → 创新生成与筛选
       → 实验方案设计 → 研究报告与导出
```

解析、抽取、索引由固定预处理流程完成；后续由 Controller 组织计划和执行，Workflow 在关键步骤插入 Reflexion 自校验。

## 主要能力

- PyMuPDF 解析 PDF，提取研究问题、方法、数据集、实验结果和局限性。
- Chroma 向量检索与 BM25 关键词检索融合，补充可回溯的原文片段。
- 生成候选研究空白、创新点和结构化实验方案。
- 新颖性、可行性、显著性三维评分，并检索相关工作辅助新颖性核查。
- 异步任务、进度事件、任务历史和论文库管理。
- OpenAI 兼容模型接口配置、模型切换、费用估算和报告导出。

模型评分和召回片段不等于经过独立验证的科研结论。当前空白分析会补充原文片段，尚未实现逐条证据支持性判定与自动剔除；最终研究判断需核对原文和相关工作。

## 技术栈

后端：Python 3.12、FastAPI、Pydantic、OpenAI 兼容 SDK、SQLite。

检索：sentence-transformers、Chroma、BM25。

前端：React 18、TypeScript、Vite。

## 本地启动

```bash
git clone https://github.com/shen0115/PaperResearch-Agent.git
cd PaperResearch-Agent
python -m venv .venv
```

Windows PowerShell 激活虚拟环境：

```powershell
.venv\Scripts\Activate.ps1
Copy-Item .env.example .env
python -m pip install -r backend/requirements.txt
python run_backend.py
```

在本地 `.env` 填入自己的模型凭据，或在模型设置页面配置兼容接口。Embedding 首次加载可能需要下载模型，也可以在 `.env` 中指定本地模型路径。

另开终端启动前端：

```bash
cd frontend
npm ci
npm run dev
```

打开前端终端显示的地址。后端接口文档通常位于 `http://127.0.0.1:8000/docs`。

模型设置中的密钥加密保存使用 Windows DPAPI。其他系统应通过 `.env` 配置凭据，不应依赖 Windows 专用的保存功能。

## 目录

```text
backend/
  api/            HTTP 接口与任务管理
  agents/         Agent 与报告生成
  orchestrator/   Controller 工作流与自校验
  tools/          论文解析 抽取 检索和生成工具
  rag/            分块 向量 BM25 与融合检索
  storage/        本地持久化与报告导出
  llm/            模型调用与费用估算
frontend/         React 交互页面
.env.example      不含真实密钥的配置样例
```

## 凭据与运行数据

仓库只包含源码和空白配置样例。`.env`、`data/`、上传论文、模型配置数据库、缓存、报告、日志及个人学习记录均不属于发布内容，已由 `.gitignore` 排除。不要把真实 API Key 写入源码、截图或 README；示例配置中的密钥保持为空。

