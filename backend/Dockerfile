FROM python:3.11-slim

# opencv-python-headless still needs a couple of shared libs at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data

# Persisted state (sqlite, godfat cache, logs) lives here; mount a volume.
ENV BCPE_DB=/app/var/app.sqlite \
    BCPE_CACHE=/app/var/godfat_cache
RUN mkdir -p /app/var

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
