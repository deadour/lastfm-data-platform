from pathlib import Path

WORKFLOW = Path(".github/workflows/daily-pipeline.yml").read_text(encoding="utf-8")
ACTIVE = [line for line in WORKFLOW.splitlines() if not line.lstrip().startswith("#")]


def test_schedule_is_not_active():
    assert not any(line.strip().startswith(("schedule:", "- cron:")) for line in ACTIVE)
    assert "workflow_dispatch:" in WORKFLOW


def test_oidc_without_long_lived_secrets():
    text = "\n".join(ACTIVE)
    assert "id-token: write" in text and "azure/login@v2" in text
    for forbidden in ("client-secret", "AZURE_CLIENT_SECRET", "creds:", "AccountKey", "sig=", "connection_string"):
        assert forbidden not in text


def test_single_run_at_a_time_and_bounded():
    text = "\n".join(ACTIVE)
    assert "group: lastfm-pipeline" in text and "cancel-in-progress: false" in text
    assert "timeout-minutes: 30" in text


def test_inputs_are_passed_through_environment_not_interpolated_into_shell():
    run_lines = [line for line in ACTIVE if line.strip().startswith("run:")]
    assert all("${{" not in line for line in run_lines)
