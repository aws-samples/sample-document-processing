FROM ghcr.io/astral-sh/uv:0.7.12-python3.12-bookworm-slim@sha256:a071e4d58c7697cda6f8a8c3e64c2ffdf2b9246c6991dbd92d3c3b5ae61b5d9a

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_PROGRESS=1 \
    PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1 \
    AWS_REGION=us-east-1 \
    AWS_DEFAULT_REGION=us-east-1 \
    LLM_GATEWAY_URL=""

COPY requirements.txt requirements.txt
RUN uv pip install --no-cache-dir -r requirements.txt

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

COPY src/ src/

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"]

CMD ["python", "-m", "src.supervisor"]
