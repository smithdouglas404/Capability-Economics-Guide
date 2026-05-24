FROM python:3.12-slim

# System deps:
#   build-essential — needed at pip-install time for any C extension that
#     doesn't ship a python:3.12-slim wheel (graphiti-core's deps drag in
#     numpy/tiktoken which sometimes compile).
#   curl — used by Railway healthcheck + by us for FalkorDB ping.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (so the layer caches across app code changes).
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY app /app/app

EXPOSE 8000

# Single uvicorn worker is fine — graphiti operations are I/O-bound (FalkorDB
# + OpenAI/OpenRouter). Bump --workers if Railway metrics show CPU contention.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
