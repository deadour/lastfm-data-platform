"""Small local Streamlit consumer for prepared Phase 5 outputs."""

from pathlib import Path
import json

import pandas as pd
import plotly.express as px
import streamlit as st


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "gold_enriched"


@st.cache_data
def load_mart(name: str) -> pd.DataFrame:
    path = DATA / f"{name}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing prepared mart: {path}. Run the enriched build first.")
    return pd.read_parquet(path)


@st.cache_data
def load_metadata() -> dict:
    path = DATA / "_metadata.json"
    if not path.exists():
        raise FileNotFoundError("Missing enriched metadata. Run the enriched build first.")
    return json.loads(path.read_text(encoding="utf-8"))


st.set_page_config(page_title="Last.fm Listening", page_icon="♫", layout="wide")
st.title("Last.fm listening, enriched")
st.caption("Prepared Gold Enriched outputs · recorded listening, not total consumption")

try:
    metadata = load_metadata()
    profile = metadata["profile"]
    quality = metadata["quality"]
except (FileNotFoundError, KeyError, json.JSONDecodeError) as exc:
    st.error(str(exc))
    st.stop()

artist_profile = load_mart("artist_profile")
track_stats = load_mart("track_stats") if (DATA / "track_stats.parquet").exists() else None
yearly = load_mart("era_comparison")
genre = load_mart("genre_evolution")
evolution = load_mart("artist_evolution")
discovery = load_mart("discovery_enriched")
concentration = load_mart("concentration")
diversity = load_mart("diversity")
patterns = load_mart("time_patterns")
geography = load_mart("geography_evolution")

overview, taste, discovery_tab, patterns_tab, methodology = st.tabs([
    "Overview", "Taste evolution", "Discovery & loyalty", "Patterns & geography", "Methodology"
])

with overview:
    cols = st.columns(4)
    cols[0].metric("Recorded scrobbles", f"{profile['events_analyzed']:,}")
    cols[1].metric("Artists", f"{profile['artists_enriched']:,}")
    cols[2].metric("Tracks", f"{len(track_stats):,}" if track_stats is not None else "n/a")
    cols[3].metric("Tagged event coverage", f"{quality['tagged_event_coverage_pct']:.1f}%")
    st.info("Pre-2020 tracking is partial. The latest recorded calendar year is marked incomplete; neither caveat represents total real-world consumption.")
    st.subheader("Recorded listening by year")
    st.plotly_chart(px.bar(yearly, x="year", y="scrobbles", color="tracking_era", hover_data=["partial_calendar_year", "scrobbles_per_active_day"]), width="stretch")
    st.subheader("Most-played artists")
    st.dataframe(artist_profile[["source_artist_name", "total_scrobbles", "active_years", "primary_genre_family", "country"]].head(20), hide_index=True, width="stretch")

with taste:
    st.subheader("Genre/style evolution")
    selected = st.multiselect("Genre families", sorted(genre["genre_family"].dropna().unique()), default=list(genre["genre_family"].dropna().unique())[:6])
    view = genre[genre["genre_family"].isin(selected)]
    st.plotly_chart(px.area(view, x="year", y="share_of_year", color="genre_family", facet_row="tracking_era", hover_data=["weighted_scrobbles", "genre_tag_coverage"]), width="stretch")
    st.caption("Shares are based on inverse-rank weights over the five highest-ranked provider tags per artist; they are not raw scrobble counts per tag.")
    st.subheader("Artist evolution")
    names = evolution.sort_values("scrobbles", ascending=False)["artist_name"].drop_duplicates().head(100).tolist()
    chosen = st.multiselect("Artists", names, default=names[:5])
    st.dataframe(evolution[evolution["artist_name"].isin(chosen)][["year", "artist_name", "scrobbles", "share_of_year", "rank", "lifecycle"]], hide_index=True, width="stretch")

with discovery_tab:
    st.subheader("Discovery")
    st.plotly_chart(px.bar(discovery, x="year", y=["new_artists", "new_tracks"], barmode="group"), width="stretch")
    st.plotly_chart(px.line(discovery, x="year", y="new_artist_share", color="tracking_era", markers=True), width="stretch")
    st.subheader("Concentration and diversity")
    left, right = st.columns(2)
    left.plotly_chart(px.line(concentration, x="year", y=["top_1_share", "top_5_share", "top_10_share", "top_25_share", "top_50_share"], markers=True), width="stretch")
    right.plotly_chart(px.line(diversity, x="year", y=["artists_per_100_scrobbles", "tracks_per_100_scrobbles"], markers=True), width="stretch")
    st.subheader("Artist lifecycle labels")
    st.dataframe(evolution["lifecycle"].value_counts().rename_axis("lifecycle").reset_index(name="artist_year_rows"), hide_index=True, width="stretch")

with patterns_tab:
    st.subheader("Local-time listening patterns")
    consistent_patterns = patterns[patterns["tracking_era"] == "consistent_tracking"]
    heatmap = consistent_patterns.groupby(["local_weekday", "local_hour"], as_index=False)["scrobbles"].sum()
    weekday_labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    heatmap["weekday"] = heatmap["local_weekday"].map(dict(enumerate(weekday_labels)))
    heatmap["local_hour"] = heatmap["local_hour"].astype(int)
    st.plotly_chart(px.density_heatmap(heatmap, x="local_hour", y="weekday", z="scrobbles", category_orders={"local_hour": list(range(24)), "weekday": weekday_labels}, labels={"local_hour": "Local hour", "weekday": "Local weekday", "scrobbles": "Scrobbles"}), width="stretch")
    st.caption("Local time is reconstructed using known historical timezone periods. UTC remains the canonical event timestamp.")
    location = consistent_patterns.groupby("location", as_index=False)["scrobbles"].sum()
    st.plotly_chart(px.bar(location, x="location", y="scrobbles", title="Consistent-tracking events by known location"), width="stretch")
    st.subheader("Artist countries where metadata is available")
    country = geography[geography["country"] != "unknown"].groupby("country", as_index=False).agg(scrobbles=("scrobbles", "sum"), unique_artists=("unique_artists", "sum"))
    st.caption(f"Country metadata covers {quality['geographic_event_coverage_pct']:.1f}% of recorded events. Provider country codes are not interpreted as nationality.")
    st.plotly_chart(px.bar(country.sort_values("scrobbles", ascending=False).head(20), x="country", y="scrobbles"), width="stretch")

with methodology:
    st.markdown("""
    **Source:** Last.fm completed scrobbles, transformed through Bronze, Silver and Gold.

    **Enrichment:** MusicBrainz artist metadata and community-generated Last.fm tags.
    Artist metadata is joined many-to-one to events. Tags remain a separate one-to-many
    association and are weighted by inverse provider rank over the top five tags.

    **Tracking:** 2020-01-01 is the consistent-tracking boundary. Pre-2020 data is
    partial, and the latest calendar year is explicitly marked incomplete.

    **Interpretation:** These views describe recorded musical listening and metadata.
    They do not infer mood, personality, mental health, politics, religion or any
    other sensitive personal characteristic.
    """)
    st.json({"quality": quality, "profile": profile})
