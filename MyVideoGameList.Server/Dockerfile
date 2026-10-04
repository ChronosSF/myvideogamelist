# syntax=docker/dockerfile:1
#
# The API image. Build context is the repository root, so the root NuGet.Config applies:
#
#   docker build -t mvgl-api:local -f MyVideoGameList.Server/Dockerfile .
#
# Three stages. `build` publishes the application; `bundle` produces the EF migration bundle
# that the migration task runs before each release (ADR 0007, 0044); `final` is the runtime
# image with both. Nothing environment-specific and no secret is baked in: the task
# definition supplies ASPNETCORE_ENVIRONMENT, the connection string, PGPASSWORD and the IGDB
# credentials (ADR 0005).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# The project file first, alone, so the restore layer is reused until a package changes.
COPY NuGet.Config ./
COPY MyVideoGameList.Server/MyVideoGameList.Server.csproj MyVideoGameList.Server/
RUN dotnet restore MyVideoGameList.Server/MyVideoGameList.Server.csproj

COPY MyVideoGameList.Server/ MyVideoGameList.Server/
RUN dotnet publish MyVideoGameList.Server/MyVideoGameList.Server.csproj \
    -c Release --no-restore -o /app/publish

FROM build AS bundle
# Generating the bundle runs Program.cs as far as building the host, which is why these three
# are set. EF's tooling assumes Development unless told otherwise, and the deployed bundle runs
# as Production, so it is generated as Production too. The host refuses to build with an empty
# connection string, and refuses to build as Production without a Data Protection key store
# (ADR 0043) - both are right for a running service and both are meaningless here, where no
# connection is opened and nothing is protected. The connection string below reaches nothing.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ConnectionStrings__DefaultConnection="Host=localhost;Database=bundle" \
    DataProtection__AllowEphemeralKeys=true
RUN dotnet tool install --global dotnet-ef --version "10.0.*"
ENV PATH="$PATH:/root/.dotnet/tools"
RUN dotnet ef migrations bundle \
    --project MyVideoGameList.Server \
    --configuration Release \
    --target-runtime linux-x64 \
    --output /app/efbundle

# The default tag, not Alpine or chiseled: those ship without ICU and run only in
# invariant-globalisation mode.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
# Npgsql probes for the Kerberos library at startup and, without it, writes "Cannot load library
# libgssapi_krb5.so.2" as an error on every start. It is harmless - password authentication does
# not use it - but an error line at every task start is one that will be chased in CloudWatch
# sooner or later, so the library goes in.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish ./
# Beside appsettings.json on purpose: EF resolves configuration from the directory the bundle
# runs in, and the migration task overrides the entry point to /app/efbundle.
COPY --from=bundle /app/efbundle ./efbundle
# The image's own non-root user; 8080 is its default port.
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "MyVideoGameList.Server.dll"]
