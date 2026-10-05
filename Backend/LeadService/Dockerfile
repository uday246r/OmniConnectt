# Build context is Backend/, NOT Backend/LeadService/:
#
#   docker build -f LeadService/Dockerfile -t omniconnect-lead .
#
# The service references Backend/Shared/OmniConnect.Validation (the platform's field-format engine),
# which lies outside the service folder, and inherits Backend/Directory.Build.props.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Manifests first, so the restore layer caches independently of source edits.
COPY Directory.Build.props ./
COPY Shared/OmniConnect.Validation/OmniConnect.Validation.csproj Shared/OmniConnect.Validation/
COPY Shared/OmniConnect.Hosting/OmniConnect.Hosting.csproj Shared/OmniConnect.Hosting/
COPY LeadService/LeadManagement.Api.csproj LeadService/
RUN dotnet restore LeadService/LeadManagement.Api.csproj

COPY Shared/ Shared/
COPY LeadService/ LeadService/
RUN dotnet publish LeadService/LeadManagement.Api.csproj -c Release -o /app/publish --no-restore

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
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3   CMD ["dotnet", "LeadManagement.Api.dll", "--healthcheck", "http://127.0.0.1:8080/health/live"]

ENTRYPOINT ["dotnet", "LeadManagement.Api.dll"]
