import asyncio
from sqlalchemy import text
from app.core.database import async_session_factory

async def check():
    async with async_session_factory() as db:
        rows = (await db.execute(text(
            "SELECT d.id, d.original_filename, d.section_label, d.sort_order, "
            "SUBSTR(d.summary, 1, 150) as summary_preview, "
            "SUBSTR(d.raw_ocr_text, 1, 150) as ocr_preview "
            "FROM documents d ORDER BY d.section_label, d.sort_order"
        ))).all()
        for r in rows:
            label = r[2] or "NONE"
            print(f"[{label}] #{r[3]} | {r[1]}")
            if r[4]:
                print(f"   Summary: {r[4]}")
            if r[5]:
                print(f"   OCR: {r[5][:100]}...")
            print()

asyncio.run(check())
