using System.Net;
using System.Net.Mail;
using Amazon.Runtime;
using Amazon.SimpleEmailV2;
using Amazon.SimpleEmailV2.Model;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Services.Email;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The two ways an email leaves: through SES, or into a folder. What both owe is the same: the
/// message as composed, from the configured sender, and no recipient's address in any log line or
/// exception, because SES's own refusal names them (ADR 0088).
/// </summary>
public class EmailTransportTests
{
    private const string Recipient = "someone@example.com";

    private static readonly EmailSender Sender = new(
        new MailAddress("noreply@myvideogamelist.net", "MyVideoGameList"),
        new MailAddress("support@myvideogamelist.net"));

    private static readonly EmailMessage Message = new(
        "account confirmation", Recipient, "Confirm your address", "Open this link: https://example.test/confirm");

    private readonly RecordingLoggerProvider log = new();

    private ILogger<T> Logger<T>() => new LoggerFactory([log]).CreateLogger<T>();

    private void AssertNoLineNames(string address) =>
        Assert.DoesNotContain(log.Entries, entry =>
            entry.Message.Contains(address, StringComparison.OrdinalIgnoreCase)
            || entry.State.Any(pair => pair.Value?.ToString()?.Contains(address, StringComparison.OrdinalIgnoreCase) == true));

    [Fact]
    public async Task SendAsync_Ses_SendsTheMessageFromTheConfiguredSender()
    {
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        SendEmailRequest? sent = null;
        ses.SendEmailAsync(Arg.Do<SendEmailRequest>(request => sent = request), Arg.Any<CancellationToken>())
            .Returns(new SendEmailResponse { MessageId = "0107-abc" });
        var transport = new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>());

        await transport.SendAsync(Message with { Html = "<p>Open this link</p>" }, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal("\"MyVideoGameList\" <noreply@myvideogamelist.net>", sent.FromEmailAddress);
        Assert.Equal(new[] { "support@myvideogamelist.net" }, sent.ReplyToAddresses);
        Assert.Equal(new[] { Recipient }, sent.Destination.ToAddresses);
        Assert.Equal("Confirm your address", sent.Content.Simple.Subject.Data);
        Assert.Equal(Message.Text, sent.Content.Simple.Body.Text.Data);
        Assert.Equal("<p>Open this link</p>", sent.Content.Simple.Body.Html.Data);
        Assert.All(
            new[] { sent.Content.Simple.Subject, sent.Content.Simple.Body.Text, sent.Content.Simple.Body.Html },
            content => Assert.Equal("UTF-8", content.Charset));
    }

    [Fact]
    public async Task SendAsync_SesWithoutHtml_SendsTextOnly()
    {
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        SendEmailRequest? sent = null;
        ses.SendEmailAsync(Arg.Do<SendEmailRequest>(request => sent = request), Arg.Any<CancellationToken>())
            .Returns(new SendEmailResponse { MessageId = "0107-abc" });

        await new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Null(sent.Content.Simple.Body.Html);
    }

    [Fact]
    public async Task SendAsync_Ses_LogsThePurposeAndMessageIdButNotTheAddress()
    {
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        ses.SendEmailAsync(Arg.Any<SendEmailRequest>(), Arg.Any<CancellationToken>())
            .Returns(new SendEmailResponse { MessageId = "0107-abc" });

        await new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, CancellationToken.None);

        var line = Assert.Single(log.Entries);
        Assert.Equal("account confirmation", line.Value("Purpose"));
        Assert.Equal("0107-abc", line.Value("MessageId"));
        AssertNoLineNames(Recipient);
    }

    [Fact]
    public async Task SendAsync_SesRefuses_ThrowsNotSentWithTheAddressMasked()
    {
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        ses.SendEmailAsync(Arg.Any<SendEmailRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new MessageRejectedException(
                $"Email address is not verified. The following identities failed the check in region EU-CENTRAL-1: {Recipient}",
                ErrorType.Sender, "MessageRejected", "req-1", HttpStatusCode.BadRequest));

        var exception = await Assert.ThrowsAsync<EmailNotSentException>(() =>
            new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, CancellationToken.None));

        Assert.Null(exception.InnerException);
        Assert.Contains("MessageRejected (400)", exception.Message);
        Assert.Contains("EU-CENTRAL-1: <address>", exception.Message);
        Assert.DoesNotContain(Recipient, exception.Message);
        var line = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Equal("req-1", line.Value("RequestId"));
        AssertNoLineNames(Recipient);
    }

    [Fact]
    public async Task SendAsync_SesUnreachable_ThrowsNotSent()
    {
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        ses.SendEmailAsync(Arg.Any<SendEmailRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("No such host is known."));

        var exception = await Assert.ThrowsAsync<EmailNotSentException>(() =>
            new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, CancellationToken.None));

        Assert.Contains("HttpRequestException", exception.Reason);
    }

    [Fact]
    public async Task SendAsync_SesTimesOut_ThrowsNotSentRatherThanCancelled()
    {
        // The client's own timeout ends an attempt as a cancellation the caller never asked for.
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        ses.SendEmailAsync(Arg.Any<SendEmailRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout."));

        await Assert.ThrowsAsync<EmailNotSentException>(() =>
            new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, CancellationToken.None));
    }

    [Fact]
    public async Task SendAsync_CallerCancels_LetsTheCancellationThrough()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        ses.SendEmailAsync(Arg.Any<SendEmailRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException(cancelled.Token));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, cancelled.Token));
    }

    [Fact]
    public async Task SendAsync_OurOwnBug_LeavesAsItself()
    {
        var ses = Substitute.For<IAmazonSimpleEmailServiceV2>();
        ses.SendEmailAsync(Arg.Any<SendEmailRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("ours"));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new SesEmailTransport(ses, Sender, Logger<SesEmailTransport>()).SendAsync(Message, CancellationToken.None));
    }

    [Fact]
    public async Task SendAsync_Outbox_WritesAnEmlFileAndLogsItsPathButNotTheAddress()
    {
        var folder = Directory.CreateTempSubdirectory("mvgl-outbox-test-").FullName;
        try
        {
            var transport = new OutboxEmailTransport(
                folder, Sender, TimeProvider.System, Logger<OutboxEmailTransport>());

            await transport.SendAsync(Message, CancellationToken.None);

            var file = Assert.Single(Directory.GetFiles(folder, "*.eml"));
            var eml = await File.ReadAllTextAsync(file);
            Assert.Contains("From: \"MyVideoGameList\" <noreply@myvideogamelist.net>\r\n", eml);
            Assert.Contains("Reply-To: support@myvideogamelist.net\r\n", eml);
            Assert.Contains($"To: {Recipient}\r\n", eml);
            Assert.Contains("Subject: Confirm your address\r\n", eml);
            Assert.Contains("Content-Type: text/plain; charset=utf-8\r\n", eml);
            Assert.EndsWith("\r\n\r\nOpen this link: https://example.test/confirm", eml);
            Assert.DoesNotContain(Recipient, Path.GetFileName(file));

            var line = Assert.Single(log.Entries);
            Assert.Equal(file, line.Value("Path"));
            AssertNoLineNames(Recipient);
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public void Format_WithHtml_WritesBothBodiesAsAlternatives()
    {
        var eml = Eml.Format(Message with { Html = "<p>Open</p>" }, Sender, DateTimeOffset.UnixEpoch);

        Assert.Contains("Content-Type: multipart/alternative; boundary=\"mvgl-alternative\"\r\n", eml);
        Assert.Contains("Content-Type: text/plain; charset=utf-8\r\n", eml);
        Assert.Contains("Content-Type: text/html; charset=utf-8\r\n", eml);
        Assert.EndsWith("<p>Open</p>\r\n--mvgl-alternative--\r\n", eml);
    }

    [Fact]
    public void Format_SubjectOutsideAscii_IsAnEncodedWord()
    {
        var eml = Eml.Format(Message with { Subject = "Потвърдете" }, Sender, DateTimeOffset.UnixEpoch);

        Assert.Contains("Subject: =?utf-8?B?", eml);
        Assert.DoesNotContain("Потвърдете", eml);
    }

    [Fact]
    public void Format_HeaderValueWithALineBreak_StaysOneHeader()
    {
        var eml = Eml.Format(Message with { Subject = "One\r\nBcc: someone@else.test" }, Sender, DateTimeOffset.UnixEpoch);

        Assert.DoesNotContain("\r\nBcc:", eml);
    }

    [Theory]
    [InlineData("failed the check: someone@example.com.", "failed the check: <address>")]
    [InlineData("<a@b.co>, \"c.d@e.org\"", "<<address>>, \"<address>\"")]
    [InlineData("arn:aws:ses:eu-central-1:111122223333:identity/myvideogamelist.net", "arn:aws:ses:eu-central-1:111122223333:identity/myvideogamelist.net")]
    [InlineData("two\nlines", "twolines")]
    public void Mask_MasksEveryAddressAndKeepsTheRest(string text, string expected) =>
        Assert.Equal(expected, EmailLogText.Mask(text));

    [Fact]
    public void ToString_NamesThePurposeOnly()
    {
        Assert.Equal("account confirmation email", Message.ToString());
        Assert.DoesNotContain(Recipient, $"{Message}");
    }
}
