FROM python:3.11-slim

# System deps:
#   git, build-essential, libpq-dev — needed at pip-install time so any C
#     extension without a python:3.11-slim wheel can compile from source.
#   libpq5 — runtime client lib that psycopg2/psycopg3 dynamically links
#     against. Without it the server crashes on import with
#     `libpq.so.5: cannot open shared object file`.
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

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
