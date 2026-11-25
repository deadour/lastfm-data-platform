from pathlib import Path

WORKFLOW = Path(".github/workflows/daily-pipeline.yml").read_text(encoding="utf-8")
ACTIVE = [line for line in WORKFLOW.splitlines() if not line.lstrip().startswith("#")]


def test_single_daily_schedule_and_manual_dispatch():
    crons = [line.split("#")[0].strip() for line in ACTIVE if line.strip().startswith("- cron:")]
    assert crons == ['- cron: "17 6 * * *"']  # exactly once a day, 06:17 UTC
    assert "workflow_dispatch:" in WORKFLOW


def test_scheduled_runs_fall_back_to_default_page_cap():
    # Schedule events carry no inputs, so the cap must default to 25.
    text = "\n".join(ACTIVE)
    assert "MAX_PAGES: ${{ inputs.max_pages || '25' }}" in text
    assert 'default: "25"' in text


def test_runs_in_protected_environment():
    text = "\n".join(ACTIVE)
    assert "environment: lastfm-prod" in text
    assert "contents: read" in text


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
