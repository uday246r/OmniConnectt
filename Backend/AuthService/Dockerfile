# Build context is Backend/, NOT Backend/AuthService/.
#
#   docker build -f AuthService/Dockerfile -t omniconnect-auth .
#
# This matters: TargetFramework (net10.0) is declared once in Backend/Directory.Build.props, which
# every service csproj inherits and none redeclare. With the service folder as context that file is
# outside the build and restore fails with no target framework at all. Render's "Docker Build
# Context Directory" must therefore be Backend, with the Dockerfile path AuthService/Dockerfile.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy manifests first so the restore layer caches independently of source edits.
COPY Directory.Build.props ./
COPY AuthService/AuthService.csproj AuthService/
# The platform field-format engine and the shared proxy edge.
COPY Shared/OmniConnect.Validation/OmniConnect.Validation.csproj Shared/OmniConnect.Validation/
COPY Shared/OmniConnect.Hosting/OmniConnect.Hosting.csproj Shared/OmniConnect.Hosting/
RUN dotnet restore AuthService/AuthService.csproj

COPY Shared/ Shared/
COPY AuthService/ AuthService/
RUN dotnet publish AuthService/AuthService.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Non-root. The aspnet image ships an unprivileged 'app' user for exactly this.
USER $APP_UID

ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

# The service's own binary is the probe (see OmniConnect.Hosting.ContainerHealthProbe): the aspnet
# image has no curl, and liveness — not /health, which opens a database connection — decides restarts.
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3   CMD ["dotnet", "AuthService.dll", "--healthcheck", "http://127.0.0.1:8080/health/live"]

# Honour a platform-injected $PORT (Render sets it) and fall back to 8080, the port every OmniConnect
# container listens on. `exec` so dotnet becomes PID 1 and receives SIGTERM directly — without it the
# shell swallows the signal and the platform kills the container instead of letting it drain requests.
# ENTRYPOINT, not CMD, so extra arguments are appended rather than replacing the command — the
# deployment runs `docker compose run --rm auth --migrate-only` exactly as it does for every service.
ENTRYPOINT ["sh", "-c", "exec dotnet AuthService.dll --urls http://+:${PORT:-8080} \"$@\"", "--"]
