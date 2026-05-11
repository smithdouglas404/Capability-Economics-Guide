FROM python:3.12-slim

# System deps:
#   libpq5  — runtime PostgreSQL client lib that psycopg dynamically links
#             against. mem0ai/mem0's server/Dockerfile installs the `psycopg`
#             Python wheel but NOT this system lib, so the upstream image
#             crashes on import with `ImportError: no pq wrapper available …
#             libpq library not found`. This Dockerfile exists to fix that.
#   git, build-essential, libpq-dev — needed at pip-install time so any C
#     extension without a python:3.12-slim wheel can compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        libpq5 \
        libpq-dev \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Pin mem0 to a known-good release so rebuilds are reproducible. Override
# with `--build-arg MEM0_VERSION=vX.Y.Z` when you want a newer mem0.
ARG MEM0_VERSION=v2.0.2
RUN git clone --depth 1 --branch ${MEM0_VERSION} https://github.com/mem0ai/mem0.git /app

WORKDIR /app/server

RUN pip install --no-cache-dir -r requirements.txt

# Mem0 keeps a SQLite "history" DB alongside its pgvector store. The default
# path comes from HISTORY_DB_PATH env var (e.g. /app/history/history.db) and
# Mem0 won't create the parent directory itself — it just calls sqlite3.connect
# and crashes with "unable to open database file" if the dir doesn't exist.
# Mount a Railway Volume here for persistence across restarts.
RUN mkdir -p /app/history && chmod 755 /app/history

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
