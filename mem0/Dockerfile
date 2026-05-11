FROM python:3.11-slim

# Install system dependencies including libpq5 for psycopg3
RUN apt-get update && apt-get install -y \
    git \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Clone mem0ai/mem0 repo
RUN git clone https://github.com/mem0ai/mem0.git /app

WORKDIR /app/server

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000

# Start the Mem0 API server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
