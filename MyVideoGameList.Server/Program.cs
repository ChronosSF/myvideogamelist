using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.HealthChecks;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddApiRateLimiting();
builder.Services.AddProxyHeaders(builder.Configuration);

// HSTS. A year, subdomains included, so dev.myvideogamelist.net cannot be reached over plain
// HTTP either. Preload is deliberately off: submission to the browsers' preload list is a
// commitment that is slow and awkward to undo, and it belongs to whoever owns the domain rather
// than to a default in a source file.
builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(365);
    options.IncludeSubDomains = true;
});
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("Igdb");

// Steam's news API is public and needs no key, but it is a third party on the home page's
// critical path, so it gets a short timeout of its own rather than the 100s default.
builder.Services.AddHttpClient("Steam", client =>
{
    client.Timeout = TimeSpan.FromSeconds(8);
});

builder.Services.AddSingleton<IIgdbService, IgdbService>();
builder.Services.AddSingleton<ISteamNewsService, SteamNewsService>();
builder.Services.AddSingleton<IHomeService, HomeService>();
builder.Services.AddScoped<IListService, ListService>();
builder.Services.AddScoped<IWishlistService, WishlistService>();
builder.Services.AddScoped<IFavouriteService, FavouriteService>();
builder.Services.AddScoped<IListNameService, ListNameService>();
builder.Services.AddScoped<IPlaythroughService, PlaythroughService>();
builder.Services.AddScoped<IReviewService, ReviewService>();
builder.Services.AddScoped<IStatsService, StatsService>();
builder.Services.AddScoped<IPublicProfileService, PublicProfileService>();
builder.Services.AddScoped<IGameCommunityService, GameCommunityService>();
builder.Services.AddScoped<IUserDataExporter, UserDataExporter>();
builder.Services.AddScoped<IUserNameClaimService, UserNameClaimService>();
builder.Services.AddScoped<ITrackedNewsService, TrackedNewsService>();

// The clock, injected so the event log's timestamps are controllable in tests.
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// Readiness checks. Liveness (/healthz) deliberately runs no checks - it answers
// "is the process up", not "are its dependencies well".
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database", tags: ["ready"])
    .AddCheck<IgdbHealthCheck>("igdb", tags: ["ready"]);

// ASP.NET Core Identity with EF Core store
builder.Services.AddIdentity<ApplicationUser, IdentityRole>(options =>
{
    options.Password.RequireDigit = true;
    options.Password.RequiredLength = 8;
    options.Password.RequireUppercase = false;
    options.Password.RequireLowercase = true;
    options.Password.RequireNonAlphanumeric = false;
    options.User.RequireUniqueEmail = true;
    options.SignIn.RequireConfirmedAccount = false;

    // Lockout after five wrong passwords, for fifteen minutes. Without it a password is
    // guessable at whatever rate a client can manage, and the per-IP limiter on /api/auth
    // does not cover the case this does: the same account tried from many addresses.
    //
    // A locked account is never announced. Login answers the same 401 it answers a wrong
    // password with, because "this account is locked" is a way to ask whether an address has
    // an account here - five deliberate failures against any address would answer it. The
    // message a person failing repeatedly actually sees comes from the rate limiter, which
    // partitions by address and so says nothing about who is registered.
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    options.Lockout.AllowedForNewUsers = true;

    // The username is the public handle at /u/{name}, not an email address, so Identity's own
    // validator is narrowed to the same alphabet UserNamePolicy enforces. Without this the default
    // would also accept "@", "." and "-", and any write that did not happen to go through the
    // policy — a future admin tool, a social-login auto-provision — could put a name in the
    // namespace that the policy would have refused. See docs/decisions/0027-*.
    options.User.AllowedUserNameCharacters = UserNamePolicy.AllowedCharacters;
})
.AddEntityFrameworkStores<ApplicationDbContext>()
.AddDefaultTokenProviders();

// Configure the Identity cookie to return HTTP status codes instead of redirects
// (required for SPA / API usage)
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.ExpireTimeSpan = TimeSpan.FromDays(30);
    options.SlidingExpiration = true;
    // Return 401/403 instead of redirecting to a login page
    options.Events.OnRedirectToLogin = ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});

// External social login providers.
// Credentials are supplied via environment variables or user secrets and are
// intentionally left unconfigured here so the app starts without them.
// To enable Google login set Authentication:Google:ClientId and
//   Authentication:Google:ClientSecret (e.g. via dotnet user-secrets).
// To enable Facebook login set Authentication:Facebook:AppId and
//   Authentication:Facebook:AppSecret.
var googleClientId = builder.Configuration["Authentication:Google:ClientId"];
var googleClientSecret = builder.Configuration["Authentication:Google:ClientSecret"];
if (!string.IsNullOrEmpty(googleClientId) && !string.IsNullOrEmpty(googleClientSecret))
{
    builder.Services.AddAuthentication()
        .AddGoogle(options =>
        {
            options.ClientId = googleClientId;
            options.ClientSecret = googleClientSecret;
        });
}

var facebookAppId = builder.Configuration["Authentication:Facebook:AppId"];
var facebookAppSecret = builder.Configuration["Authentication:Facebook:AppSecret"];
if (!string.IsNullOrEmpty(facebookAppId) && !string.IsNullOrEmpty(facebookAppSecret))
{
    builder.Services.AddAuthentication()
        .AddFacebook(options =>
        {
            options.AppId = facebookAppId;
            options.AppSecret = facebookAppSecret;
        });
}

var app = builder.Build();

// Migrations run automatically in Development only.
//
// Outside Development they must be a discrete deployment step, run before the new revision
// takes traffic: several ECS tasks booting at once would otherwise race each other through
// the same migration. See docs/decisions/0007-aws-target-architecture.md.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    db.Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// First, so that everything after it - the redirect below, the rate limiter's partition key,
// every logged address - is about the caller rather than about whatever forwarded the request.
// Off unless configured; see the ForwardedHeaders section in appsettings.json.
app.UseProxyHeaders();

// Then the headers that say what an answer from this API may be used for. Above the redirect
// and the rate limiter so that a 307 and a 429 carry them as well as a 200 does.
app.UseApiSecurityHeaders();

// Only redirect browser traffic. The React Router SSR server calls this API over
// plain HTTP from the same machine, and a 307 to HTTPS would fail on the dev cert.
//
// A TLS-terminating load balancer forwards plain HTTP too, so deployed behind one this
// redirects every request into a loop unless the forwarded scheme above is being honoured.
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// Before authentication, so a caller over the limit is turned away without a database
// read. Routing has already run by this point, which is what lets the limiter see which
// endpoint was matched and apply that endpoint's policy.
app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// Liveness: the process is running and can serve a request.
app.MapHealthChecks("/healthz", new HealthCheckOptions { Predicate = _ => false });

// Readiness: dependencies are reachable. Degraded still returns 200 so a degraded IGDB
// does not take the instance out of the load balancer.
app.MapHealthChecks("/readyz", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status200OK,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
    }
});

app.Run();
