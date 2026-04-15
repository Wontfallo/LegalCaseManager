import sqlite3

conn = sqlite3.connect("storage/legalcm.db")
cur = conn.cursor()

cur.execute(
    "SELECT original_filename, status, length(raw_ocr_text) as ocr_len "
    "FROM documents "
    "WHERE original_filename LIKE '%eclaration%' "
    "AND original_filename NOT LIKE '%Amendment%'"
)
for row in cur.fetchall():
    print(f"  {row[0]}: status=[{row[1]}], ocr_len={row[2]}")

# Compute similarity
from sys import path
path.insert(0, ".")
from app.api.routers.documents import _text_similarity_ratio, _text_containment_ratio

cur.execute(
    "SELECT original_filename, raw_ocr_text FROM documents "
    "WHERE original_filename IN "
    "('2 - Declaration.pdf', 'Exhibit_02_Summerhill Declaration_ocred.pdf')"
)
rows = cur.fetchall()
if len(rows) == 2:
    t1 = rows[0][1] or ""
    t2 = rows[1][1] or ""
    sim = _text_similarity_ratio(t1, t2)
    cont = _text_containment_ratio(t1, t2)
    print(f"\nJaccard similarity: {sim:.4f} ({sim*100:.1f}%)")
    print(f"Containment ratio:  {cont:.4f} ({cont*100:.1f}%)")
    print(f"  {rows[0][0]}: {len(t1)} chars")
    print(f"  {rows[1][0]}: {len(t2)} chars")
else:
    print(f"Found {len(rows)} rows")

conn.close()
