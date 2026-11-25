# Batch job image: one bounded incremental run per container start.
# Build: docker build -t lastfm-pipeline:dev .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements-job.txt .
RUN pip install -r requirements-job.txt

COPY config ./config
COPY src ./src

# Data lives on a mounted volume or is synchronized from ADLS; never baked in.
RUN useradd --create-home --uid 10001 pipeline && mkdir -p /app/data && chown pipeline /app/data
USER pipeline

# Secrets arrive as environment variables at run time (LASTFM_API_KEY, LASTFM_USERNAME).
ENTRYPOINT ["python", "-m", "src.jobs.run_pipeline"]
CMD ["--max-pages", "25"]
