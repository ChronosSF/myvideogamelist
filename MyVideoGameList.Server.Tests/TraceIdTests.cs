using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using MyVideoGameList.Server.Observability;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The id a request is known by, and the status its line reports, case by case. The pipeline as a
/// whole is <see cref="ApiPipelineTests"/>; these are the cases it cannot produce.
/// </summary>
public class TraceIdTests
{
    private sealed class ActivityFeature(Activity activity) : IHttpActivityFeature
    {
        public Activity Activity { get; set; } = activity;
    }

    private sealed class StartedResponse : HttpResponseFeature
    {
        public override bool HasStarted => true;
    }

    private static HttpContext RequestUnder(Activity? activity)
    {
        var context = new DefaultHttpContext { TraceIdentifier = "0HNPALQ7VHNMD:00000001" };
        if (activity is not null) context.Features.Set<IHttpActivityFeature>(new ActivityFeature(activity));
        return context;
    }

    [Fact]
    public void Of_ARequestWhoseActivityIsW3C_IsItsTraceId()
    {
        using var activity = new Activity("request");
        activity.SetIdFormat(ActivityIdFormat.W3C);
        activity.Start();

        Assert.Equal(activity.TraceId.ToHexString(), TraceIds.Of(RequestUnder(activity)));
    }

    [Fact]
    public void Of_ARequestWithNoActivity_IsItsRequestIdentifier()
    {
        // ASP.NET starts no activity when nothing listens and its hosting log is off altogether. The
        // log has no trace id then either, and the request identifier is the one id both still carry.
        Assert.Equal("0HNPALQ7VHNMD:00000001", TraceIds.Of(RequestUnder(activity: null)));
    }

    [Fact]
    public void Of_ARequestWhoseActivityIsHierarchical_IsItsRequestIdentifierRatherThanZeros()
    {
        // What a later-version traceparent produced before Program.cs forced the format.
        using var activity = new Activity("request");
        activity.SetIdFormat(ActivityIdFormat.Hierarchical);
        activity.Start();

        Assert.Equal("0HNPALQ7VHNMD:00000001", TraceIds.Of(RequestUnder(activity)));
    }

    [Fact]
    public void StatusOf_AnExceptionPastTheHandlerBeforeAnythingWasSent_IsA500()
    {
        // The server answers such a request with a 500, whatever the status said when it escaped. The
        // pipeline cannot produce one: the exception handler catches everything first.
        var response = new DefaultHttpContext().Response;
        response.StatusCode = 200;

        Assert.Equal(500, RequestLogMiddleware.StatusOf(response, escaped: true));
        Assert.Equal(200, RequestLogMiddleware.StatusOf(response, escaped: false));
    }

    [Fact]
    public void StatusOf_AnExceptionAfterTheStatusWasSent_IsTheStatusThatWasSent()
    {
        var context = new DefaultHttpContext();
        context.Features.Set<IHttpResponseFeature>(new StartedResponse { StatusCode = 200 });

        Assert.Equal(200, RequestLogMiddleware.StatusOf(context.Response, escaped: true));
    }
}
