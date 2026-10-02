"""Build local Gold analytical marts from Silver Parquet."""

import argparse
import logging

from .gold_builder import build_gold


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Gold listening marts from Silver scrobbles")
    parser.add_argument("--full", action="store_true", help="Rebuild all Gold marts from Silver")
    parser.add_argument("--profile", action="store_true", help="Print aggregate Gold profile metrics")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = build_gold()
    logging.info("Built Gold marts: %s", result["marts"])
    logging.info("Gold quality: %s", result["quality"])
    if args.profile or args.full:
        logging.info("Gold profile: %s", result["profile"])


if __name__ == "__main__":
    main()
