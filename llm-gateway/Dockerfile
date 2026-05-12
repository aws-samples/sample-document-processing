FROM ghcr.io/berriai/litellm:main-v1.72.6-stable@sha256:2c3f50ed1ea59ec9e175711c808c3bf15f023643fe50fb1ba1d0f9dc827a356d

WORKDIR /app

COPY config/litellm_config.yaml /app/config.yaml
COPY callbacks/ /app/callbacks/

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:4000/health')"]

# Run as non-root. Note: if the LiteLLM base image requires root for
# certain operations, document as accepted risk and remove this line.
USER nobody

CMD ["--config", "/app/config.yaml", \
     "--num_workers", "2", \
     "--run_gunicorn"]
