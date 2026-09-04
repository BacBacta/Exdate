# The capture watcher as a container: node and git around the host's own clone.
#
# The repository is bind-mounted rather than copied, because the watcher commits
# and pushes from it - it is a working copy, not an artifact. The deploy key is
# mounted read-only from the host. Build and run through docker-compose.yml
# (`docker compose up -d watcher`), or alone:
#
#   docker build -f deploy/watcher.Dockerfile -t exdate-watcher .
#   docker run -v "$PWD:/repo" -v "$HOME/.ssh:/root/.ssh:ro" --env-file .env exdate-watcher
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory /repo
WORKDIR /repo
ENV NODE_ENV=production
CMD ["node", "scripts/watch-effective-prices.mjs"]
