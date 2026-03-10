---
node_id: "study_guide_reflexion_deep_learning"
version: "a32fbf12dd27e448b24bf53bf612ae23314aa3090a63d2ea387c41fc14a792e9"
timestamp: 1773107724
confidence: 1.0000
importance: 1.0000
title: "Reflexion 自我反思 - 深入学习指南"
parents: []
---

# Reflexion 自我反思 - 深入学习指南

## 📚 理论基础（已掌握）

### 核心概念
- **Reflexion**: 通过语言反馈进行"口头强化学习"的框架
- **关键创新**: 用**语言反馈**替代传统RL的**标量奖励**
- **三大组件**: Actor（参与者）→ Evaluator（评估者）→ Self-Reflection（自我反思）

### 应用场景
1. 序列决策（AlfWorld）
2. 问答推理（HotPotQA）
3. 代码生成（HumanEval, MBPP, LeetCode）

---

## 🏗️ 核心架构详解

### 1. Actor（参与者）
```python
# 伪代码示例
class Actor:
    def __init__(self, llm, memory):
        self.llm = llm
        self.memory = memory  # 长期记忆
    
    def generate(self, state, task):
        # 结合CoT和ReAct框架
        prompt = self._build_prompt(state, task)
        action = self.llm.generate(prompt)
        return action
```

**职责**:
- 基于状态观察生成文本和动作
- 使用CoT和ReAct框架进行推理
- 维护记忆组件提供上下文

### 2. Evaluator（评估者）
```python
class Evaluator:
    def __init__(self, evaluation_mode="llm"):
        self.mode = evaluation_mode  # 'llm' 或 'rule-based'
    
    def evaluate(self, trajectory, task_goal):
        # 评估生成的轨迹
        if self.mode == "llm":
            score = self._llm_evaluate(trajectory, task_goal)
        else:
            score = self._rule_based_evaluate(trajectory, task_goal)
        return score
```

**职责**:
- 评估Actor的输出质量
- 接收轨迹（短期记忆）输入
- 输出奖励分数（标量或二元）

### 3. Self-Reflection（自我反思）
```python
class SelfReflection:
    def __init__(self, llm, memory):
        self.llm = llm
        self.memory = memory  # 持久记忆
    
    def reflect(self, trajectory, reward_signal, task):
        # 生成语言反馈
        reflection_prompt = f"""
        任务: {task}
        执行轨迹: {trajectory}
        奖励信号: {reward_signal}
        
        请分析上述执行过程，找出错误并提供改进建议：
        """
        
        reflection = self.llm.generate(reflection_prompt)
        
        # 存储到长期记忆
        self.memory.store({
            'task': task,
            'trajectory': trajectory,
            'reflection': reflection,
            'timestamp': time.now()
        })
        
        return reflection
```

**职责**:
- 生成语言强化线索
- 利用奖励信号、当前轨迹和持久记忆
- 生成具体、相关的反馈并存储

---

## 💻 完整代码实现

### 项目结构
```
reflexion/
├── core/
│   ├── __init__.py
│   ├── actor.py
│   ├── evaluator.py
│   ├── self_reflection.py
│   └── memory.py
├── llm/
│   ├── __init__.py
│   └── base.py
├── tasks/
│   ├── __init__.py
│   ├── base.py
│   └── coding_task.py
├── utils/
│   └── helpers.py
└── main.py
```

### 1. 基础LLM接口
```python
# llm/base.py
from abc import ABC, abstractmethod
from typing import List, Dict, Any

class BaseLLM(ABC):
    @abstractmethod
    def generate(self, prompt: str, **kwargs) -> str:
        pass
    
    @abstractmethod
    def generate_with_history(
        self, 
        messages: List[Dict[str, str]], 
        **kwargs
    ) -> str:
        pass

# 具体实现（使用OpenAI API）
import openai

class OpenAILLM(BaseLLM):
    def __init__(self, api_key: str, model: str = "gpt-4"):
        openai.api_key = api_key
        self.model = model
    
    def generate(self, prompt: str, temperature: float = 0.7, max_tokens: int = 1000) -> str:
        response = openai.ChatCompletion.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )
        return response.choices[0].message.content
    
    def generate_with_history(self, messages: List[Dict[str, str]], **kwargs) -> str:
        response = openai.ChatCompletion.create(
            model=self.model,
            messages=messages,
            **kwargs
        )
        return response.choices[0].message.content
```

### 2. 记忆系统
```python
# core/memory.py
from typing import List, Dict, Any, Optional
from datetime import datetime
import json

class MemoryEntry:
    def __init__(
        self, 
        task: str, 
        trajectory: Any, 
        reflection: Optional[str] = None,
        score: Optional[float] = None,
        timestamp: Optional[datetime] = None
    ):
        self.task = task
        self.trajectory = trajectory
        self.reflection = reflection
        self.score = score
        self.timestamp = timestamp or datetime.now()
    
    def to_dict(self) -> Dict:
        return {
            'task': self.task,
            'trajectory': self.trajectory,
            'reflection': self.reflection,
            'score': self.score,
            'timestamp': self.timestamp.isoformat()
        }

class Memory:
    def __init__(self, max_size: int = 100):
        self.entries: List[MemoryEntry] = []
        self.max_size = max_size
    
    def store(self, entry: MemoryEntry):
        self.entries.append(entry)
        # 保持内存大小限制
        if len(self.entries) > self.max_size:
            self.entries.pop(0)
    
    def retrieve_relevant(self, task: str, k: int = 5) -> List[MemoryEntry]:
        # 简化的相关性检索（实际应用中可以使用向量嵌入）
        # 这里使用任务字符串匹配作为示例
        relevant = []
        for entry in reversed(self.entries):  # 优先检索最近的记忆
            if any(word in entry.task.lower() for word in task.lower().split()):
                relevant.append(entry)
            if len(relevant) >= k:
                break
        return relevant
    
    def get_all_reflections(self) -> List[str]:
        return [e.reflection for e in self.entries if e.reflection]
    
    def save_to_file(self, filepath: str):
        with open(filepath, 'w') as f:
            json.dump([e.to_dict() for e in self.entries], f, indent=2)
    
    def load_from_file(self, filepath: str):
        with open(filepath, 'r') as f:
            data = json.load(f)
            self.entries = [MemoryEntry(**d) for d in data]
```

### 3. 任务基类
```python
# tasks/base.py
from abc import ABC, abstractmethod
from typing import Any, Tuple

class BaseTask(ABC):
    @abstractmethod
    def get_initial_state(self) -> Any:
        pass
    
    @abstractmethod
    def step(self, action: str) -> Tuple[Any, float, bool]:
        """
        执行动作，返回 (新状态, 奖励, 是否结束)
        """
        pass
    
    @abstractmethod
    def evaluate(self, trajectory: Any) -> float:
        """
        评估整个执行轨迹
        """
        pass
```

由于内容较长，我将在下一条继续提供完整的代码实现和项目实践指南。您希望我继续提供：
1. 完整的代码实现（Actor、Evaluator、Self-Reflection的具体实现）
2. 一个实际的编程任务示例（代码生成）
3. 进阶优化技巧
4. 相关论文和资源推荐

请告诉我您最感兴趣的部分，我将优先详细展开！
