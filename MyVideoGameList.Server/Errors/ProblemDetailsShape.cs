using Microsoft.AspNetCore.Http;
using MyVideoGameList.Server.Observability;

namespace MyVideoGameList.Server.Errors;

/// <summary>
/// One machine-readable shape for every failure, instead of a raw 500 with an HTML body in
/// Development and an empty one everywhere else.
/// </summary>
/// <remarks>
/// The customisation reaches only what is written through <see cref="IProblemDetailsService"/> or
/// built by MVC's problem details factory, which is why nothing here writes one by hand (ADR 0034).
/// </remarks>
public static class ProblemDetailsShape
{
    public static IServiceCollection AddApiProblemDetails(this IServiceCollection services) =>
        services.AddProblemDetails(options => options.CustomizeProblemDetails = Customize);

    internal static void Customize(ProblemDetailsContext context)
    {
        // Correlating a user's report with a log line needs an identifier in both. This is the
        // request's trace id - the SSR server's when a render made the call, so the same one the
        // page names - and never anything about the person.
        context.ProblemDetails.Extensions["traceId"] = TraceIds.Of(context.HttpContext);

        // The exception, in Development only. The alternative is reading the console beside a
        // useless response - and putting it in a deployed answer would hand out stack traces.
        if (context.HttpContext.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment()
            && context.Exception is not null)
        {
            context.ProblemDetails.Extensions["exception"] = context.Exception.ToString();
        }
    }
}
