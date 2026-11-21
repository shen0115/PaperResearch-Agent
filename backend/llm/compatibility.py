"""Probe the same named tool and schema that the paper extractor uses."""
from datetime import datetime, timezone

from backend.llm.client import DeepSeekClient, ModelRequestRejected
from backend.llm.json_utils import parse_json_safe
from backend.storage.workspace import ModelConfig
from backend.tools.extract_schema import EXTRACT_FUNCTION_SCHEMA, EXTRACT_TOOL_CHOICE


class ProbeOutputLimit(RuntimeError):
    """Probe reached its output cap before a complete result was available."""


async def check_extraction_compatibility(config: ModelConfig) -> dict:
    client = DeepSeekClient(config)
    client.timeout = min(client.timeout, 20)
    client.max_retries = 0
    client.client.max_retries = 0
    messages = [
        {"role": "system", "content": "通过指定工具抽取论文结构化字段。只使用样例中的信息，未提供的字段留空。"},
        {"role": "user", "content": "# 查找算法对比（合成样例）\n## 方法\n在有序整数列表上比较线性查找和二分查找。\n## 结果\n二分查找的平均比较次数更少。"},
    ]
    status = "incompatible"
    try:
        response = await client.chat(
            messages, tools=[EXTRACT_FUNCTION_SCHEMA], tool_choice=EXTRACT_TOOL_CHOICE, max_tokens=900,
        )
        choice = response.choices[0] if response.choices else None
        calls = (choice.message.tool_calls or []) if choice else []
        if choice and choice.finish_reason == "length":
            raise ProbeOutputLimit
        for call in calls:
            if call.type != "function" or call.function.name != EXTRACT_FUNCTION_SCHEMA["function"]["name"]:
                continue
            arguments = parse_json_safe(call.function.arguments)
            method = arguments.get("method") if isinstance(arguments, dict) else None
            if (
                isinstance(method, dict)
                and isinstance(method.get("value"), str)
                and method["value"].strip()
                and isinstance(method.get("source_sections"), list)
                and any(isinstance(section, str) and section.strip() for section in method["source_sections"])
            ):
                status = "passed"
                break
        message = (
            "已验证模型可以调用抽取工具，并返回可解析且带有出处的字段。"
            if status == "passed"
            else "模型未按要求返回可解析的抽取字段与出处。请尝试同一服务的其他模型。"
        )
    except ModelRequestRejected:
        message = "服务商拒绝了正式抽取使用的指定工具请求（HTTP 400）。可尝试支持指定工具调用的模型。"
    finally:
        await client.client.close()
    return {"status": status, "message": message, "tested_at": datetime.now(timezone.utc).isoformat()}
