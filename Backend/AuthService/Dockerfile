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
# The platform field-format engine, shared with LeadService.
COPY Shared/OmniConnect.Validation/OmniConnect.Validation.csproj Shared/OmniConnect.Validation/
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
EXPOSE 8081

# Honour the platform's injected $PORT (Render sets it) and fall back to 8081 elsewhere. `exec` so
# dotnet becomes PID 1 and receives SIGTERM directly — without it the shell swallows the signal and
# the platform kills the container on timeout instead of letting it drain in-flight requests.
CMD ["sh", "-c", "exec dotnet AuthService.dll --urls http://+:${PORT:-8081}"]
