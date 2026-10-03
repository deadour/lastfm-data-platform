from pathlib import Path

import pytest


APP = Path(__file__).parents[1] / "dashboard" / "app.py"
REAL_OUTPUTS = Path(__file__).parents[1] / "data" / "gold_enriched" / "time_patterns.parquet"


@pytest.mark.skipif(not REAL_OUTPUTS.exists(), reason="requires the local Gold Enriched build")
def test_dashboard_renders_local_time_marts():
    from streamlit.testing.v1 import AppTest

    app = AppTest.from_file(str(APP)).run(timeout=30)

    assert not app.exception
    assert len(app.get("plotly_chart")) >= 1
