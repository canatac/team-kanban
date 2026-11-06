FROM rust:1.83-slim AS build
WORKDIR /app
COPY backend/ ./
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/team-kanban-backend /usr/local/bin/team-kanban-backend
ENV RUST_LOG=info
EXPOSE 8080
CMD ["team-kanban-backend"]
