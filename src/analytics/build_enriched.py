"""CLI for Phase 5 enriched analytical marts."""

import argparse
import json
import logging

from .enriched_builder import build_enriched


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Phase 5 enriched analytical marts")
    parser.add_argument("--profile", action="store_true", help="Log aggregate quality and profile metrics")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = build_enriched()
    logging.info("Built enriched marts: %s", result["marts"])
    if args.profile:
        logging.info("Enriched quality: %s", json.dumps(result["quality"], sort_keys=True))
        logging.info("Enriched profile: %s", json.dumps(result["profile"], sort_keys=True))


if __name__ == "__main__":
    main()
