"""Small local Streamlit consumer for prepared Phase 5 outputs."""

from pathlib import Path
import json

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import plotly.io as pio
import streamlit as st


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "gold_enriched"

ACCENT = "#ff3b4f"
# Last.fm logo glyph (Simple Icons, CC0).
LASTFM_LOGO = '<svg viewBox="0 0 24 24" width="32" height="32" fill="white" role="img" aria-label="Last.fm"><path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/></svg>'
PALETTE = ["#ff3b4f", "#ffb347", "#5ad1c4", "#8b7bff", "#f472b6", "#60a5fa", "#a3e635", "#fbbf24", "#94a3b8"]
ERA_COLORS = {"consistent_tracking": ACCENT, "partial_tracking": "#5b5b6e"}
HEATMAP_SCALE = [[0, "#15151d"], [0.35, "#5c1424"], [0.7, "#c81e3a"], [1, "#ffb3bd"]]

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

html, body, [class*="css"], .stMarkdown, .stTabs, button, input { font-family: 'Inter', sans-serif; }
.stApp {
    background:
        radial-gradient(1200px 500px at 10% -10%, rgba(255,59,79,0.16), transparent 60%),
        radial-gradient(900px 400px at 100% 0%, rgba(139,123,255,0.10), transparent 60%),
        #0b0b10;
}
.block-container { padding-top: 2.2rem; max-width: 1280px; }
header[data-testid="stHeader"] { background: transparent; }

.hero { display: flex; align-items: center; gap: 18px; margin-bottom: 0.4rem; }
.hero-logo {
    width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center;
    font-size: 28px; color: white;
    background: linear-gradient(135deg, #e31b23, #a50d14);
    box-shadow: 0 10px 30px rgba(255,59,79,0.35);
}
.hero-title { font-size: 2.1rem; font-weight: 800; letter-spacing: -0.03em; margin: 0; padding: 0; line-height: 1.1; }
.hero-title .grad { background: linear-gradient(90deg, #ff3b4f, #ffb347); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.hero p { color: #9a9aab; margin: 4px 0 0; font-size: 0.95rem; }

.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 1.4rem 0 1.2rem; }
@media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.kpi {
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
    border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; padding: 18px 20px;
    position: relative; overflow: hidden;
}
.kpi::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--c); }
.kpi-label { color: #9a9aab; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
.kpi-value { font-size: 1.9rem; font-weight: 800; letter-spacing: -0.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
.kpi-icon { position: absolute; right: 16px; top: 14px; font-size: 1.3rem; opacity: 0.55; }

.section { margin: 1.8rem 0 0.4rem; }
.section h3 { font-size: 1.15rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.section p { color: #8a8a9b; font-size: 0.86rem; margin: 2px 0 0; }

.note {
    border: 1px solid rgba(255,179,71,0.25); background: rgba(255,179,71,0.07);
    color: #f3d9b1; border-radius: 12px; padding: 10px 14px; font-size: 0.85rem;
}

.stTabs [role="tablist"] {
    gap: 4px; background: rgba(255,255,255,0.03); padding: 5px; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.06);
}
.stTabs [data-testid="stTab"] { height: 40px; border-radius: 10px; padding: 0 18px; display: flex; align-items: center; transition: background .15s; color: #a0a0b2; font-weight: 600; }
.stTabs [data-testid="stTab"][aria-selected="true"], .stTabs [data-testid="stTab"][data-selected] { background: rgba(255,59,79,0.14) !important; color: #fff !important; }
.stTabs [data-baseweb="tab-highlight"], .stTabs [data-baseweb="tab-border"] { display: none; }
.stTabs [data-testid="stTab"] p { font-weight: 600; font-size: 0.9rem; }

[data-testid="stPlotlyChart"], [data-testid="stDataFrame"] {
    background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px; padding: 10px;
}
[data-testid="stCaptionContainer"] { color: #7c7c8e; }

.method-card {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px; padding: 18px 20px; height: 100%;
}
.method-card h4 { margin: 0 0 6px; font-size: 0.95rem; color: #fff; }
.method-card p { margin: 0; color: #a0a0b2; font-size: 0.88rem; line-height: 1.5; }
</style>
"""


def register_plotly_theme() -> None:
    template = go.layout.Template(pio.templates["plotly_dark"])
    template.layout.update(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif", color="#c9c9d6", size=12),
        colorway=PALETTE,
        margin=dict(l=10, r=10, t=40, b=10),
        hoverlabel=dict(bgcolor="#1d1d27", bordercolor="#2c2c3a", font=dict(color="#fff")),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0, title_text="", bgcolor="rgba(0,0,0,0)"),
        xaxis=dict(gridcolor="rgba(255,255,255,0.05)", zeroline=False, linecolor="rgba(255,255,255,0.1)"),
        yaxis=dict(gridcolor="rgba(255,255,255,0.06)", zeroline=False, linecolor="rgba(0,0,0,0)"),
        bargap=0.25,
    )
    pio.templates["lastfm"] = template
    pio.templates.default = "lastfm"


def chart(fig, height: int = 380, target=st) -> None:
    fig.update_layout(height=height, legend_title_text="")
    fig.for_each_trace(lambda t: t.update(name=pretty(t.name)) if t.name else None)
    fig.update_traces(selector=dict(type="bar"), marker_line_width=0)
    fig.update_traces(selector=dict(type="scatter"), line=dict(width=2.5), marker=dict(size=7))
    target.plotly_chart(fig, width="stretch", config={"displayModeBar": False})


def section(title: str, subtitle: str = "", target=st) -> None:
    sub = f"<p>{subtitle}</p>" if subtitle else ""
    target.markdown(f'<div class="section"><h3>{title}</h3>{sub}</div>', unsafe_allow_html=True)


def kpis(items: list[tuple[str, str, str, str]]) -> None:
    cards = "".join(
        f'<div class="kpi" style="--c:{color}"><div class="kpi-icon">{icon}</div>'
        f'<div class="kpi-label">{label}</div><div class="kpi-value">{value}</div></div>'
        for label, value, icon, color in items
    )
    st.markdown(f'<div class="kpi-grid">{cards}</div>', unsafe_allow_html=True)


def pretty(name: str) -> str:
    """Humanize snake_case identifiers; leave real names (artists, genres) untouched."""
    return name.replace("_", " ").capitalize() if "_" in name else name


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
st.markdown(CSS, unsafe_allow_html=True)
register_plotly_theme()

st.markdown(
    f'<div class="hero"><div class="hero-logo">{LASTFM_LOGO}</div><div>'
    '<div class="hero-title">Last.fm listening, <span class="grad">enriched</span></div>'
    "<p>Prepared Gold Enriched outputs · recorded listening, not total consumption</p>"
    "</div></div>",
    unsafe_allow_html=True,
)

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

kpis([
    ("Recorded scrobbles", f"{profile['events_analyzed']:,}", "▶", ACCENT),
    ("Artists", f"{profile['artists_enriched']:,}", "🎤", "#ffb347"),
    ("Tracks", f"{len(track_stats):,}" if track_stats is not None else "n/a", "💿", "#5ad1c4"),
    ("Tagged event coverage", f"{quality['tagged_event_coverage_pct']:.1f}%", "🏷", "#8b7bff"),
])

overview, taste, discovery_tab, patterns_tab, methodology = st.tabs([
    "Overview", "Taste evolution", "Discovery & loyalty", "Patterns & geography", "Methodology"
])

with overview:
    st.markdown(
        '<div class="note">⚠ Pre-2020 tracking is partial. The latest recorded calendar year is marked incomplete; '
        "neither caveat represents total real-world consumption.</div>",
        unsafe_allow_html=True,
    )
    section("Recorded listening by year", "Scrobbles per calendar year, split by tracking era")
    fig = px.bar(
        yearly, x="year", y="scrobbles", color="tracking_era", color_discrete_map=ERA_COLORS,
        hover_data=["partial_calendar_year", "scrobbles_per_active_day"],
        labels={"scrobbles": "Scrobbles", "year": "", "tracking_era": "Era"},
    )
    chart(fig, 400)

    section("Most-played artists", "Top 20 by total recorded scrobbles")
    top = artist_profile[["source_artist_name", "total_scrobbles", "active_years", "primary_genre_family", "country"]].head(20)
    st.dataframe(
        top, hide_index=True, width="stretch", height=560,
        column_config={
            "source_artist_name": st.column_config.TextColumn("Artist"),
            "total_scrobbles": st.column_config.ProgressColumn(
                "Scrobbles", format="%d", min_value=0, max_value=int(top["total_scrobbles"].max())
            ),
            "active_years": st.column_config.NumberColumn("Active years"),
            "primary_genre_family": st.column_config.TextColumn("Genre"),
            "country": st.column_config.TextColumn("Country"),
        },
    )

with taste:
    section("Genre / style evolution", "Weighted share of each year's listening by genre family")
    selected = st.multiselect("Genre families", sorted(genre["genre_family"].dropna().unique()), default=list(genre["genre_family"].dropna().unique())[:6])
    view = genre[genre["genre_family"].isin(selected)]
    fig = px.area(
        view, x="year", y="share_of_year", color="genre_family", facet_row="tracking_era",
        hover_data=["weighted_scrobbles", "genre_tag_coverage"],
        labels={"share_of_year": "Share", "year": "", "genre_family": "Genre"},
    )
    fig.update_yaxes(tickformat=".0%")
    fig.for_each_annotation(lambda a: a.update(text=pretty(a.text.split("=")[-1])))
    chart(fig, 520)
    st.caption("Shares are based on inverse-rank weights over the five highest-ranked provider tags per artist; they are not raw scrobble counts per tag.")

    section("Artist evolution", "Pick artists to compare year by year")
    names = evolution.sort_values("scrobbles", ascending=False)["artist_name"].drop_duplicates().head(100).tolist()
    chosen = st.multiselect("Artists", names, default=names[:5])
    picked = evolution[evolution["artist_name"].isin(chosen)]
    if not picked.empty:
        fig = px.line(picked.sort_values("year"), x="year", y="scrobbles", color="artist_name", markers=True,
                      labels={"scrobbles": "Scrobbles", "year": "", "artist_name": "Artist"})
        chart(fig, 360)
    st.dataframe(
        picked[["year", "artist_name", "scrobbles", "share_of_year", "rank", "lifecycle"]],
        hide_index=True, width="stretch",
        column_config={
            "artist_name": "Artist",
            "share_of_year": st.column_config.NumberColumn("Share of year", format="percent"),
        },
    )

with discovery_tab:
    section("Discovery", "New artists and tracks appearing for the first time each year")
    left, right = st.columns(2)
    fig = px.bar(discovery, x="year", y=["new_artists", "new_tracks"], barmode="group",
                 labels={"value": "Count", "year": "", "variable": ""})
    fig.for_each_trace(lambda t: t.update(name=pretty(t.name)))
    chart(fig, 360, left)
    fig = px.line(discovery, x="year", y="new_artist_share", color="tracking_era", markers=True,
                  color_discrete_map=ERA_COLORS, labels={"new_artist_share": "New-artist share", "year": ""})
    fig.update_yaxes(tickformat=".0%")
    chart(fig, 360, right)

    section("Concentration and diversity", "How much listening is held by the top artists, and how varied it is")
    left, right = st.columns(2)
    fig = px.line(concentration, x="year", y=["top_1_share", "top_5_share", "top_10_share", "top_25_share", "top_50_share"],
                  markers=True, labels={"value": "Share", "year": "", "variable": ""})
    fig.update_yaxes(tickformat=".0%")
    fig.for_each_trace(lambda t: t.update(name=pretty(t.name).replace(" share", "")))
    chart(fig, 380, left)
    fig = px.line(diversity, x="year", y=["artists_per_100_scrobbles", "tracks_per_100_scrobbles"],
                  markers=True, labels={"value": "Per 100 scrobbles", "year": "", "variable": ""})
    fig.for_each_trace(lambda t: t.update(name=pretty(t.name)))
    chart(fig, 380, right)

    section("Artist lifecycle labels")
    lifecycle = evolution["lifecycle"].value_counts().rename_axis("lifecycle").reset_index(name="artist_year_rows")
    fig = px.bar(lifecycle.sort_values("artist_year_rows"), x="artist_year_rows", y="lifecycle", orientation="h",
                 labels={"artist_year_rows": "Artist-year rows", "lifecycle": ""})
    fig.update_traces(marker_color=ACCENT)
    chart(fig, 300)

with patterns_tab:
    section("Local-time listening patterns", "When you listen, by weekday and local hour (consistent-tracking era)")
    consistent_patterns = patterns[patterns["tracking_era"] == "consistent_tracking"]
    heatmap = consistent_patterns.groupby(["local_weekday", "local_hour"], as_index=False)["scrobbles"].sum()
    weekday_labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    heatmap["weekday"] = heatmap["local_weekday"].map(dict(enumerate(weekday_labels)))
    heatmap["local_hour"] = heatmap["local_hour"].astype(int)
    fig = px.density_heatmap(
        heatmap, x="local_hour", y="weekday", z="scrobbles", nbinsx=24,
        category_orders={"local_hour": list(range(24)), "weekday": weekday_labels},
        labels={"local_hour": "Local hour", "weekday": "", "scrobbles": "Scrobbles"},
        color_continuous_scale=HEATMAP_SCALE,
    )
    fig.update_traces(xgap=3, ygap=3)
    fig.update_xaxes(dtick=1, showgrid=False)
    fig.update_yaxes(showgrid=False, categoryorder="array", categoryarray=weekday_labels[::-1])
    fig.update_layout(coloraxis_colorbar=dict(title="", thickness=10, outlinewidth=0))
    chart(fig, 380)
    st.caption("Local time is reconstructed using known historical timezone periods. UTC remains the canonical event timestamp.")

    left, right = st.columns(2)
    with left:
        section("By known location", "Consistent-tracking events")
        location = consistent_patterns.groupby("location", as_index=False)["scrobbles"].sum()
        fig = px.bar(location.sort_values("scrobbles"), x="scrobbles", y="location", orientation="h",
                     labels={"scrobbles": "Scrobbles", "location": ""})
        fig.update_traces(marker_color="#5ad1c4")
        chart(fig, 380)
    with right:
        section("Artist countries", f"Metadata covers {quality['geographic_event_coverage_pct']:.1f}% of recorded events")
        country = geography[geography["country"] != "unknown"].groupby("country", as_index=False).agg(scrobbles=("scrobbles", "sum"), unique_artists=("unique_artists", "sum"))
        fig = px.bar(country.sort_values("scrobbles", ascending=False).head(20), x="country", y="scrobbles",
                     hover_data=["unique_artists"], labels={"scrobbles": "Scrobbles", "country": ""})
        fig.update_traces(marker_color="#8b7bff")
        chart(fig, 380)
    st.caption("Provider country codes are not interpreted as nationality.")

with methodology:
    cards = [
        ("📥 Source", "Last.fm completed scrobbles, transformed through Bronze, Silver and Gold."),
        ("🧬 Enrichment", "MusicBrainz artist metadata and community-generated Last.fm tags. Artist metadata is joined "
                         "many-to-one to events. Tags remain a separate one-to-many association and are weighted by "
                         "inverse provider rank over the top five tags."),
        ("📅 Tracking", "2020-01-01 is the consistent-tracking boundary. Pre-2020 data is partial, and the latest "
                       "calendar year is explicitly marked incomplete."),
        ("🧭 Interpretation", "These views describe recorded musical listening and metadata. They do not infer mood, "
                             "personality, mental health, politics, religion or any other sensitive personal characteristic."),
    ]
    st.write("")
    for row in (cards[:2], cards[2:]):
        cols = st.columns(2)
        for col, (title, body) in zip(cols, row):
            col.markdown(f'<div class="method-card"><h4>{title}</h4><p>{body}</p></div>', unsafe_allow_html=True)
        st.write("")
    with st.expander("Raw quality & profile metadata"):
        st.json({"quality": quality, "profile": profile})
