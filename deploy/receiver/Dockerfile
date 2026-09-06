# exdate's own webhook subscriber. One file, no dependencies and no install step: the whole point
# of this container is to be the least interesting thing in the deployment, so that a delivery
# failing says something about the sender rather than about the receiver's build.
FROM node:22-alpine
WORKDIR /app
COPY deploy/receiver/server.mjs ./server.mjs
USER node
CMD ["node", "server.mjs"]
