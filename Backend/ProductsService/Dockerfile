# Build context is Backend/, NOT Backend/ProductsService/:
#
#   docker build -f ProductsService/Dockerfile -t omniconnect-products .
#
# The API references its clean-architecture layers under src/, plus Backend/Shared (the field-format
# engine and the shared proxy edge), and inherits Backend/Directory.Build.props.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Manifests first, so the restore layer caches independently of source edits.
COPY Directory.Build.props ./
COPY Shared/OmniConnect.Validation/OmniConnect.Validation.csproj Shared/OmniConnect.Validation/
COPY Shared/OmniConnect.Hosting/OmniConnect.Hosting.csproj Shared/OmniConnect.Hosting/
COPY ProductsService/ProductMarketplace.Api.csproj ProductsService/
COPY ProductsService/src/ProductMarketplace.Domain/ProductMarketplace.Domain.csproj ProductsService/src/ProductMarketplace.Domain/
COPY ProductsService/src/ProductMarketplace.Application/ProductMarketplace.Application.csproj ProductsService/src/ProductMarketplace.Application/
COPY ProductsService/src/ProductMarketplace.Infrastructure/ProductMarketplace.Infrastructure.csproj ProductsService/src/ProductMarketplace.Infrastructure/
RUN dotnet restore ProductsService/ProductMarketplace.Api.csproj

COPY Shared/ Shared/
COPY ProductsService/ ProductsService/
RUN dotnet publish ProductsService/ProductMarketplace.Api.csproj -c Release -o /app/publish --no-restore /p:UseAppHost=false

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
  CMD ["dotnet", "ProductMarketplace.Api.dll", "--healthcheck", "http://127.0.0.1:8080/health/live"]

ENTRYPOINT ["dotnet", "ProductMarketplace.Api.dll"]
