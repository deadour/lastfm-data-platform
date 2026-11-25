from pathlib import Path


TEXT = Path(".github/workflows/export-frontend.yml").read_text(encoding="utf-8")
ACTIVE = "\n".join(line for line in TEXT.splitlines() if not line.lstrip().startswith("#"))


def test_cloud_export_is_gated_without_adding_a_cron():
    assert "workflow_dispatch:" in ACTIVE and "workflow_run:" in ACTIVE
    assert "workflows: [daily-pipeline]" in ACTIVE and "branches: [main]" in ACTIVE
    assert "vars.FRONTEND_EXPORT_AUTOMATIC == 'true'" in ACTIVE
    assert "github.event.workflow_run.conclusion == 'success'" in ACTIVE
    assert "github.event.workflow_run.head_repository.full_name == github.repository" in ACTIVE
    assert "github.event.workflow_run.event == 'schedule'" in ACTIVE
    assert "github.ref == 'refs/heads/main'" in ACTIVE
    assert "cron:" not in ACTIVE and "pull_request_target" not in ACTIVE
    assert "github.event.workflow_run.head_sha" not in ACTIVE


def test_exporter_uses_oidc_without_ingestion_secrets_or_checkpoint_commands():
    assert "azure/login@v2" in ACTIVE and "id-token: write" in ACTIVE
    assert "environment: lastfm-prod" in ACTIVE and "persist-credentials: false" in ACTIVE
    assert "python -m src.jobs.export_stats" in ACTIVE
    for forbidden in ("cloud_run", "seed", "LASTFM_API_KEY", "LASTFM_USERNAME", "AZURE_CLIENT_SECRET", "creds:", "AccountKey"):
        assert forbidden not in ACTIVE


def test_only_the_allowlisted_public_json_is_uploaded_as_an_artifact():
    assert "path: output/stats.json" in ACTIVE
    assert "retention-days: 1" in ACTIVE
    assert "path: site/frontend/public/data" in ACTIVE
    for forbidden in ("path: data/", "path: output/\n", "path: .", "path: /tmp", "path: ${{ runner.temp }}"):
        assert forbidden not in ACTIVE


def test_publication_is_opt_in_and_build_includes_the_generated_stats():
    assert "if: github.event_name == 'workflow_run' || inputs.publish" in ACTIVE
    assert "default: false" in ACTIVE
    assert "npm test" in ACTIVE and "npm run build" in ACTIVE
    assert "test -s dist/data/stats.json" in ACTIVE
    assert "CLOUDFLARE_PAGES_API_TOKEN" in ACTIVE
    assert "--branch=main" in ACTIVE
