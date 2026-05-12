"""
Integration tests for LLM Gateway and Supervisor Agent.

Usage:
  # 1. First, set up port forwarding to the internal ALB (run in a separate terminal):
  #    See setup instructions printed when running this script.
  #
  # 2. Test LLM Gateway only:
  #    python tests/test_integration.py gateway
  #
  # 3. Test Supervisor Agent only (calls Bedrock directly, needs AWS credentials):
  #    python tests/test_integration.py supervisor
  #
  # 4. Test both:
  #    python tests/test_integration.py all
"""

import argparse
import json
import shutil
import subprocess  # nosec B404  # noqa: S404 — used for controlled AWS CLI calls in integration tests
import sys
import time
import urllib.request
from urllib.parse import urlparse

def _safe_urlopen(url: str, timeout: int = 10, **kwargs):
    """Open a URL after validating the scheme is http or https."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL scheme '{parsed.scheme}' is not allowed. Only http/https are permitted.")
    req = urllib.request.Request(url, **kwargs)
    return urllib.request.urlopen(req, timeout=timeout)  # noqa: S310  # nosec B310

# ---------------------------------------------------------------------------
# LLM Gateway Tests
# ---------------------------------------------------------------------------

def test_gateway_health(base_url: str) -> bool:
    """Test the gateway health endpoint."""
    url = f"{base_url}/health/liveliness"
    print(f"\n--- Gateway Health Check: GET {url}")
    try:
        with _safe_urlopen(url, timeout=10) as resp:
            body = resp.read().decode()
            print(f"  Status: {resp.status}")
            print(f"  Body:   {body}")
            return resp.status == 200
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def test_gateway_models(base_url: str, api_key: str) -> bool:
    """List available models on the gateway."""
    url = f"{base_url}/v1/models"
    print(f"\n--- Gateway Models: GET {url}")
    try:
        with _safe_urlopen(url, timeout=10, headers={"Authorization": f"Bearer {api_key}"}) as resp:
            body = json.loads(resp.read().decode())
            models = [m["id"] for m in body.get("data", [])]
            print(f"  Status: {resp.status}")
            print(f"  Models: {models}")
            return len(models) > 0
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def test_gateway_chat_completion(base_url: str, api_key: str) -> bool:
    """Send a chat completion request through the gateway."""
    url = f"{base_url}/v1/chat/completions"
    payload = json.dumps({
        "model": "claude-fast",
        "messages": [{"role": "user", "content": "Reply with exactly: GATEWAY_OK"}],
        "max_tokens": 20,
    }).encode()

    print(f"\n--- Gateway Chat Completion: POST {url}")
    print(f"  Model: claude-fast (Haiku)")
    try:
        start = time.time()
        with _safe_urlopen(
            url,
            timeout=30,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        ) as resp:
            elapsed = time.time() - start
            body = json.loads(resp.read().decode())
            content = body["choices"][0]["message"]["content"]
            model = body.get("model", "unknown")
            usage = body.get("usage", {})
            print(f"  Status:   {resp.status}")
            print(f"  Model:    {model}")
            print(f"  Response: {content}")
            print(f"  Tokens:   {usage}")
            print(f"  Latency:  {elapsed:.2f}s")
            return resp.status == 200
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def test_gateway_primary_model(base_url: str, api_key: str) -> bool:
    """Test the primary model (Sonnet) through the gateway."""
    url = f"{base_url}/v1/chat/completions"
    payload = json.dumps({
        "model": "claude-primary",
        "messages": [{"role": "user", "content": "Reply with exactly: PRIMARY_OK"}],
        "max_tokens": 20,
    }).encode()

    print(f"\n--- Gateway Primary Model: POST {url}")
    print(f"  Model: claude-primary (Sonnet)")
    try:
        start = time.time()
        with _safe_urlopen(
            url,
            timeout=60,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        ) as resp:
            elapsed = time.time() - start
            body = json.loads(resp.read().decode())
            content = body["choices"][0]["message"]["content"]
            model = body.get("model", "unknown")
            usage = body.get("usage", {})
            print(f"  Status:   {resp.status}")
            print(f"  Model:    {model}")
            print(f"  Response: {content}")
            print(f"  Tokens:   {usage}")
            print(f"  Latency:  {elapsed:.2f}s")
            return resp.status == 200
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


# ---------------------------------------------------------------------------
# Supervisor Agent Tests
# ---------------------------------------------------------------------------

def test_supervisor_models_import() -> bool:
    """Test that Pydantic models parse correctly."""
    print("\n--- Supervisor: Pydantic Models Import")
    try:
        sys.path.insert(0, "agents/supervisor")
        from src.models import SupervisorInput, SupervisorOutput

        with open("agents/supervisor/tests/fixtures/sample_payload.json") as f:
            payload = json.load(f)

        inputs = SupervisorInput(**payload)
        print(f"  pdfS3Path:    {inputs.pdfS3Path}")
        print(f"  customFields: {len(inputs.customFields)} fields")
        print(f"  ssmParams:    chunk_size={inputs.ssmParams.chunk_size}, pages={inputs.ssmParams.pages_per_chunk}")
        print(f"  outputSchema: {len(inputs.outputSchema.get('properties', {}))} properties")

        output = SupervisorOutput(outputS3Path="s3://test/output/result.json")
        print(f"  Output model: {output.model_dump()}")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def _make_sample_pdf(pages: int = 3) -> bytes:
    """Create a simple multi-page PDF in memory for testing."""
    from pypdf import PdfWriter
    from pypdf._page import PageObject
    from io import BytesIO

    writer = PdfWriter()
    for i in range(pages):
        page = PageObject.create_blank_page(width=612, height=792)
        writer.add_page(page)

    # Add text via annotations (pypdf doesn't easily add text to blank pages,
    # so we'll rely on the LLM handling empty text gracefully)
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_supervisor_agent_invocation() -> bool:
    """Test the supervisor agent end-to-end (calls LLM Gateway, mocks S3)."""
    print("\n--- Supervisor: Full Agent Invocation (via LLM Gateway, S3 mocked)")
    print("  This test makes real LLM calls via the gateway and may take 1-3 minutes...")
    try:
        sys.path.insert(0, "agents/supervisor")
        from unittest.mock import patch, MagicMock
        from src.models import SupervisorInput
        from src.supervisor import _build_prompt, _supervisor

        with open("agents/supervisor/tests/fixtures/sample_payload.json") as f:
            payload = json.load(f)

        inputs = SupervisorInput(**payload)
        prompt = _build_prompt(inputs)
        print(f"  Prompt length: {len(prompt)} chars")
        print(f"  Invoking supervisor agent...")

        # Create a mock PDF for the tools to read
        sample_pdf = _make_sample_pdf(pages=25)
        print(f"  Mock PDF: {len(sample_pdf)} bytes, 25 pages")

        # Mock S3 for both tools/s3.py and tools/pdf.py
        mock_s3 = MagicMock()
        mock_s3.get_object.return_value = {"Body": MagicMock(read=lambda: sample_pdf)}
        mock_s3.put_object.return_value = {}

        start = time.time()
        with patch("src.tools.s3._s3", mock_s3), patch("src.tools.pdf._s3", mock_s3):
            result = _supervisor(prompt)
        elapsed = time.time() - start

        result_str = str(result)
        print(f"  Elapsed: {elapsed:.1f}s")
        print(f"  Raw output ({len(result_str)} chars):")
        print(f"  {result_str[:500]}")

        # Check if S3 write was called
        if mock_s3.put_object.called:
            call_args = mock_s3.put_object.call_args
            print(f"  S3 write called: Bucket={call_args.kwargs.get('Bucket', call_args[1].get('Bucket', 'N/A'))}")

        # Extract JSON from output (model may include markdown headers around it)
        import re
        json_match = re.search(r'\{[^{}]*"outputS3Path"[^{}]*\}', result_str)
        if json_match:
            output_data = json.loads(json_match.group())
            print(f"  Parsed output: {output_data}")
            print(f"  outputS3Path: {output_data['outputS3Path']}")
            return True
        else:
            print(f"  WARNING: No outputS3Path JSON found in response")
            return False
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


# ---------------------------------------------------------------------------
# ECS Exec Gateway Test (from within VPC)
# ---------------------------------------------------------------------------

def test_gateway_via_ecs_exec() -> bool:
    """Test gateway from within the VPC using ECS Exec."""
    print("\n--- Gateway via ECS Exec (in-VPC test)")

    aws_cli = shutil.which("aws")
    if not aws_cli:
        print("  FAILED: 'aws' CLI not found in PATH")
        return False

    try:
        task_arn = subprocess.check_output(  # nosec B603  # noqa: S603
            [
                aws_cli, "ecs", "list-tasks",
                "--cluster", "llm-gateway",
                "--service-name", "llm-gateway-service",
                "--region", "us-east-1",
                "--query", "taskArns[0]",
                "--output", "text",
            ],
            text=True,
        ).strip()
        print(f"  Task: {task_arn.split('/')[-1]}")

        result = subprocess.run(  # nosec B603  # noqa: S603
            [
                aws_cli, "ecs", "execute-command",
                "--cluster", "llm-gateway",
                "--task", task_arn,
                "--container", "litellm",
                "--interactive",
                "--region", "us-east-1",
                "--command",
                'python -c "import urllib.request, json; '
                + "r = urllib.request.urlopen('http://localhost:4000/health/liveliness'); "
                + "print(f'Health: {r.status}'); "
                + 'print(r.read().decode())"',
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        print(f"  Output: {result.stdout.strip()}")
        if result.returncode != 0:
            print(f"  Stderr: {result.stderr.strip()[:200]}")
        return result.returncode == 0
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_gateway_tests(base_url: str, api_key: str) -> list[tuple[str, bool]]:
    results = []
    results.append(("Gateway Health", test_gateway_health(base_url)))
    results.append(("Gateway Models", test_gateway_models(base_url, api_key)))
    results.append(("Gateway Chat (Haiku)", test_gateway_chat_completion(base_url, api_key)))
    results.append(("Gateway Chat (Sonnet)", test_gateway_primary_model(base_url, api_key)))
    return results


def run_supervisor_tests() -> list[tuple[str, bool]]:
    results = []
    results.append(("Supervisor Models", test_supervisor_models_import()))
    results.append(("Supervisor Agent", test_supervisor_agent_invocation()))
    return results


def print_results(results: list[tuple[str, bool]]):
    print("\n" + "=" * 50)
    print("RESULTS")
    print("=" * 50)
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
    total = len(results)
    passed = sum(1 for _, p in results if p)
    print(f"\n  {passed}/{total} passed")


def main():
    parser = argparse.ArgumentParser(description="Integration tests for LLM Gateway and Supervisor Agent")
    parser.add_argument("target", choices=["gateway", "supervisor", "ecs-exec", "all"], help="What to test")
    parser.add_argument("--gateway-url", default="http://localhost:4000", help="LLM Gateway URL (default: localhost:4000 via port forward)")
    parser.add_argument("--api-key", required=True, help="LiteLLM admin API key")
    args = parser.parse_args()

    print("=" * 50)
    print("Document Processing - Integration Tests")
    print("=" * 50)

    results = []

    if args.target in ("gateway", "all"):
        print(f"\nGateway URL: {args.gateway_url}")
        print("NOTE: The gateway ALB is IP-restricted. To test locally via SSM port forwarding:")
        print("  aws ssm start-port-forwarding-session \\")
        print("    --target <ec2-instance-id-in-vpc> \\")
        print("    --document-name AWS-StartPortForwardingSessionToRemoteHost \\")
        print("    --parameters '{\"host\":[\"<LLM_GATEWAY_ALB_DNS>\"],\"portNumber\":[\"80\"],\"localPortNumber\":[\"4000\"]}'")
        print("")
        results.extend(run_gateway_tests(args.gateway_url, args.api_key))

    if args.target == "ecs-exec":
        results.append(("ECS Exec Health", test_gateway_via_ecs_exec()))

    if args.target in ("supervisor", "all"):
        results.extend(run_supervisor_tests())

    print_results(results)
    sys.exit(0 if all(p for _, p in results) else 1)


if __name__ == "__main__":
    main()
