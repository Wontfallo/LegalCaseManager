FROM python:3.12-slim AS base

WORKDIR /app

# System dependencies for Tesseract OCR, pdf2image, and SQLite
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    libmagic1 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create storage directories (SQLite DB + uploads live here, mounted as volume)
RUN mkdir -p /app/storage/uploads

# Non-root user for security
RUN groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid appuser appuser \
    && chown -R appuser:appuser /app/storage

USER appuser

EXPOSE 8080

# Single worker for SQLite (no concurrent writes); use --workers 4 with Postgres
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
