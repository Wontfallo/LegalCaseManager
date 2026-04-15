from __future__ import annotations

import json
import uuid
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DBSession, require_case_access
from app.core.logging import get_logger
from app.models.case import Case
from app.models.communication import Communication
from app.models.document import Document
from app.models.timeline_event import TimelineEvent
from app.schemas.assistant import (
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantMessage,
    AssistantToolCall,
)
from app.schemas.documents import DuplicateCandidate, DuplicateGroup
from app.services.document_organization import (
    infer_section_label,
    organize_documents_with_ai,
    parse_llm_json,
)
from app.services.llm_provider import chat_completion, get_active_chat_provider
from app.services.vectorization_service import semantic_search

logger = get_logger("assistant_router")
router = APIRouter(prefix="/api/cases/{case_id}/assistant", tags=["Assistant"])


def _preview(text: str | None, limit: int = 220) -> str:
    if not text:
        return ""
    cleaned = " ".join(text.split())
    return cleaned[:limit]


def _compact_documents(documents: list[Document], limit: int = 80) -> list[dict[str, Any]]:
    return [
        {
            "id": str(doc.id),
            "filename": doc.original_filename,
            "section": doc.section_label or infer_section_label(doc.original_filename, doc.summary, doc.raw_ocr_text),
            "status": doc.status,
            "summary": _preview(doc.summary, 160),
        }
        for doc in documents[:limit]
    ]


async def _load_case_context(case_id: uuid.UUID, db: DBSession) -> dict[str, Any]:
    case_result = await db.execute(select(Case).where(Case.id == case_id))
    case_obj = case_result.scalar_one_or_none()
    if case_obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Case not found.")

    docs = (
        (
            await db.execute(
                select(Document)
                .where(Document.case_id == case_id)
                .order_by(Document.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    comm_count = (
        await db.execute(
            select(func.count()).select_from(Communication).where(Communication.case_id == case_id)
        )
    ).scalar_one()
    timeline_count = (
        await db.execute(
            select(func.count()).select_from(TimelineEvent).where(TimelineEvent.case_id == case_id)
        )
    ).scalar_one()

    section_counts = Counter((doc.section_label or "Ungrouped") for doc in docs)

    return {
        "case": case_obj,
        "documents": docs,
        "summary": {
            "case_id": str(case_obj.id),
            "title": case_obj.title,
            "status": str(case_obj.status),
            "description": case_obj.description,
            "document_count": len(docs),
            "communication_count": comm_count,
            "timeline_event_count": timeline_count,
            "sections": dict(section_counts),
            "documents": _compact_documents(docs),
        },
    }


def _tool_list_documents(documents: list[Document], arguments: dict[str, Any]) -> dict[str, Any]:
    section = str(arguments.get("section") or "").strip().lower()
    status = str(arguments.get("status") or "").strip().lower()
    filename_contains = str(arguments.get("filename_contains") or "").strip().lower()
    limit = min(max(int(arguments.get("limit", 30)), 1), 100)

    filtered = []
    for doc in documents:
        if section and (doc.section_label or "").lower() != section:
            continue
        if status and (doc.status or "").lower() != status:
            continue
        if filename_contains and filename_contains not in (doc.original_filename or "").lower():
            continue
        filtered.append(doc)

    return {
        "count": len(filtered),
        "documents": [
            {
                "document_id": str(doc.id),
                "filename": doc.original_filename,
                "section_label": doc.section_label,
                "status": doc.status,
                "summary": _preview(doc.summary, 220),
                "ocr_excerpt": _preview(doc.raw_ocr_text, 220),
            }
            for doc in filtered[:limit]
        ],
    }


def _tool_get_document_details(documents: list[Document], arguments: dict[str, Any]) -> dict[str, Any]:
    requested_id = str(arguments.get("document_id") or "").strip()
    filename_contains = str(arguments.get("filename_contains") or "").strip().lower()

    matches: list[Document] = []
    for doc in documents:
        if requested_id and str(doc.id) == requested_id:
            matches = [doc]
            break
        if filename_contains and filename_contains in (doc.original_filename or "").lower():
            matches.append(doc)

    if not matches:
        return {"matches": [], "message": "No matching document found."}

    return {
        "matches": [
            {
                "document_id": str(doc.id),
                "filename": doc.original_filename,
                "section_label": doc.section_label,
                "status": doc.status,
                "summary": doc.summary,
                "ocr_excerpt": (doc.raw_ocr_text or "")[:3000],
            }
            for doc in matches[:5]
        ]
    }


async def _tool_semantic_search(case_id: uuid.UUID, arguments: dict[str, Any]) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip()
    if not query:
        return {"results": [], "message": "No search query provided."}
    top_k = min(max(int(arguments.get("top_k", 6)), 1), 10)
    results = await semantic_search(query=query, case_id=str(case_id), top_k=top_k)
    return {"results": results}


async def _tool_organize_documents(case_id: uuid.UUID, documents: list[Document], db: DBSession) -> dict[str, Any]:
    suggestions = await organize_documents_with_ai(case_id=case_id, documents=documents)
    await db.flush()
    return {
        "updated_count": len(suggestions),
        "documents": [item.model_dump(mode="json") for item in suggestions[:50]],
    }


def _find_duplicate_groups(documents: list[Document]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    by_hash: dict[str, list[Document]] = {}
    for doc in documents:
        if doc.file_hash:
            by_hash.setdefault(doc.file_hash, []).append(doc)

    for docs in by_hash.values():
        if len(docs) < 2:
            continue
        groups.append(
            {
                "reason": "Exact same file hash",
                "documents": [
                    {
                        "document_id": str(doc.id),
                        "original_filename": doc.original_filename,
                        "status": doc.status,
                        "created_at": doc.created_at.isoformat(),
                        "match_type": "file_hash",
                        "confidence": 1.0,
                    }
                    for doc in docs
                ],
            }
        )
    return groups


async def _run_tool(
    tool_name: str,
    arguments: dict[str, Any],
    case_id: uuid.UUID,
    documents: list[Document],
    db: DBSession,
) -> tuple[dict[str, Any], str]:
    if tool_name == "list_documents":
        result = _tool_list_documents(documents, arguments)
        return result, f"Listed {result['count']} documents."
    if tool_name == "get_document_details":
        result = _tool_get_document_details(documents, arguments)
        return result, f"Found {len(result.get('matches', []))} matching documents."
    if tool_name == "semantic_search":
        result = await _tool_semantic_search(case_id, arguments)
        return result, f"Found {len(result.get('results', []))} semantic search results."
    if tool_name == "organize_documents":
        result = await _tool_organize_documents(case_id, documents, db)
        return result, f"Reorganized {result['updated_count']} documents."
    if tool_name == "scan_duplicates":
        result = {"duplicate_groups": _find_duplicate_groups(documents)}
        return result, f"Found {len(result['duplicate_groups'])} duplicate groups."
    return {"error": f"Unknown tool: {tool_name}"}, f"Tool {tool_name} is not available."


async def _plan_tool_calls(
    case_summary: dict[str, Any],
    messages: list[AssistantMessage],
) -> list[dict[str, Any]]:
    latest_user_message = next((m.content for m in reversed(messages) if m.role == "user"), "")

    if get_active_chat_provider() is None:
        lowered = latest_user_message.lower()
        if "organize" in lowered:
            return [{"tool_name": "organize_documents", "arguments": {}}]
        if "duplicate" in lowered:
            return [{"tool_name": "scan_duplicates", "arguments": {}}]
        if "search" in lowered or "find" in lowered or "mention" in lowered:
            return [{"tool_name": "semantic_search", "arguments": {"query": latest_user_message, "top_k": 6}}]
        return [{"tool_name": "list_documents", "arguments": {"limit": 20}}]

    planner_prompt = (
        "You are planning tool usage for a legal case assistant. "
        "Return JSON only with shape {'tool_calls': [...]} where each tool call has keys tool_name and arguments. "
        "Use zero to three tool calls. Available tools: "
        "list_documents(section?, status?, filename_contains?, limit?), "
        "get_document_details(document_id?, filename_contains?), "
        "semantic_search(query, top_k?), "
        "organize_documents(), "
        "scan_duplicates(). "
        "Use organize_documents when the user asks to organize, regroup, recategorize, or fix document folders. "
        "Use semantic_search for questions about what documents mention a topic. "
        "Use get_document_details when the user asks about a specific file."
    )
    planner_input = {
        "case_summary": case_summary,
        "recent_messages": [m.model_dump() for m in messages[-8:]],
        "latest_user_message": latest_user_message,
    }
    try:
        response = await chat_completion(
            system_prompt=planner_prompt,
            user_prompt=json.dumps(planner_input),
            temperature=0.1,
            max_tokens=1200,
            json_mode=True,
        )
        parsed = parse_llm_json(response, {"tool_calls": []})
        tool_calls = parsed.get("tool_calls", []) if isinstance(parsed, dict) else []
        valid = []
        for item in tool_calls[:3]:
            if not isinstance(item, dict):
                continue
            tool_name = str(item.get("tool_name") or "").strip()
            arguments = item.get("arguments") or {}
            if tool_name:
                valid.append({"tool_name": tool_name, "arguments": arguments})
        return valid
    except Exception as exc:
        logger.warning("assistant_tool_planning_failed", error=str(exc))
        return []


async def _final_answer(
    case_summary: dict[str, Any],
    messages: list[AssistantMessage],
    tool_outputs: list[dict[str, Any]],
) -> str:
    latest_user_message = next((m.content for m in reversed(messages) if m.role == "user"), "")
    if get_active_chat_provider() is None:
        if tool_outputs:
            return json.dumps(tool_outputs[0], indent=2)
        return "No active AI provider is configured for assistant chat."

    system_prompt = (
        "You are the in-app LegalCM case assistant. "
        "Answer directly and practically. Help the user understand, organize, and review their case documents. "
        "When tool outputs are available, rely on them. Do not invent facts. "
        "Use filenames and sections when helpful. Keep the answer concise but useful."
    )
    final_input = {
        "case_summary": case_summary,
        "recent_messages": [m.model_dump() for m in messages[-10:]],
        "latest_user_message": latest_user_message,
        "tool_outputs": tool_outputs,
    }
    response = await chat_completion(
        system_prompt=system_prompt,
        user_prompt=json.dumps(final_input),
        temperature=0.2,
        max_tokens=1800,
    )
    return response.strip()


@router.post("/chat", response_model=AssistantChatResponse)
async def chat_with_case_assistant(
    case_id: uuid.UUID,
    body: AssistantChatRequest,
    db: DBSession,
    user: CurrentUser,
) -> AssistantChatResponse:
    await require_case_access(case_id, user, db)

    context = await _load_case_context(case_id, db)
    documents = context["documents"]
    case_summary = context["summary"]

    tool_plans = await _plan_tool_calls(case_summary, body.messages)
    tool_calls: list[AssistantToolCall] = []
    tool_outputs: list[dict[str, Any]] = []

    for planned in tool_plans:
        tool_name = planned["tool_name"]
        arguments = planned.get("arguments") or {}
        result, summary = await _run_tool(tool_name, arguments, case_id, documents, db)
        tool_outputs.append({"tool_name": tool_name, "arguments": arguments, "result": result})
        tool_calls.append(
            AssistantToolCall(
                tool_name=tool_name,
                arguments=arguments,
                result_summary=summary,
            )
        )

    if any(call.tool_name == "organize_documents" for call in tool_calls):
        await db.commit()
        context = await _load_case_context(case_id, db)
        case_summary = context["summary"]
    else:
        await db.rollback()

    answer = await _final_answer(case_summary, body.messages, tool_outputs)
    return AssistantChatResponse(
        message=AssistantMessage(role="assistant", content=answer),
        tool_calls=tool_calls,
    )
