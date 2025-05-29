# Build and compile the supervisor
FROM rust:1.87-bookworm AS build_stage
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN apt update -y && \
    apt upgrade -y && \
    apt install libclang-dev xorg-dev libxcb-shape0-dev libxcb-xfixes0-dev clang avahi-daemon libavahi-client-dev -y
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt update -y && apt upgrade -y && apt install avahi-daemon libavahi-client3 -y && apt clean
WORKDIR /app
COPY entrypoint.sh entrypoint.sh
COPY --from=build_stage /app/target/release/mdns-server /app/
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/mdns-server"]
