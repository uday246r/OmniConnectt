# Build context is Backend/, NOT Backend/Customer360Service/:
#
#   docker build -f Customer360Service/Dockerfile -t omniconnect-customer360 .
#
# The service references Backend/Shared/OmniConnect.Hosting (the platform's shared proxy edge), which
# lies outside the service folder. Backend/.dockerignore keeps every .env and build output out.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Manifests first, so the restore layer caches independently of source edits.
COPY Directory.Build.props ./
COPY Shared/OmniConnect.Hosting/OmniConnect.Hosting.csproj Shared/OmniConnect.Hosting/
COPY Customer360Service/backend.csproj Customer360Service/
RUN dotnet restore Customer360Service/backend.csproj

COPY Shared/ Shared/
COPY Customer360Service/ Customer360Service/
RUN dotnet publish Customer360Service/backend.csproj -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Non-root. The aspnet image ships an unprivileged 'app' user for exactly this.
USER $APP_UID

ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

# The service's own binary is the probe (see OmniConnect.Hosting.ContainerHealthProbe): the aspnet
# image has no curl, and liveness — not /health, which opens a database connection — decides restarts.
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 \
  CMD ["dotnet", "backend.dll", "--healthcheck", "http://127.0.0.1:8080/health/live"]

ENTRYPOINT ["dotnet", "backend.dll"]
