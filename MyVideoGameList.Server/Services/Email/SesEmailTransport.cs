using Amazon.Runtime;
using Amazon.SimpleEmailV2;
using Amazon.SimpleEmailV2.Model;

namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Sends through Amazon SES's v2 API, one <c>SendEmail</c> per message.
/// </summary>
/// <remarks>
/// <para>
/// <b>Simple content, not raw MIME.</b> SES builds the message from a subject and one or two bodies,
/// signs it with the domain's DKIM key, and owns the MIME. Nothing here writes a header SES would
/// otherwise write.
/// </para>
/// <para>
/// <b>No log line holds an address.</b> A sent message is logged by its purpose and the id SES gave
/// it, which is what a bounce or a complaint will name later. A refusal is logged by its error code
/// and SES's text with every address masked, because that text names the recipient.
/// </para>
/// <para>
/// <b>Cancelled only by the caller.</b> The client's own timeout ends an attempt as an
/// <see cref="OperationCanceledException"/> as well, and that one is a failure to send, not a
/// cancellation: it leaves as an <see cref="EmailNotSentException"/> like every other.
/// </para>
/// </remarks>
internal sealed class SesEmailTransport(
    IAmazonSimpleEmailServiceV2 ses,
    EmailSender sender,
    ILogger<SesEmailTransport> logger) : IEmailTransport
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        var request = new SendEmailRequest
        {
            FromEmailAddress = sender.From.ToString(),
            ReplyToAddresses = [sender.ReplyTo.Address],
            Destination = new Destination { ToAddresses = [message.To] },
            Content = new EmailContent
            {
                Simple = new Message
                {
                    Subject = Utf8(message.Subject),
                    Body = new Body
                    {
                        Text = Utf8(message.Text),
                        Html = message.Html is null ? null : Utf8(message.Html),
                    },
                },
            },
        };

        SendEmailResponse response;
        try
        {
            response = await ses.SendEmailAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (AmazonServiceException exception)
        {
            // SES answered and said no: a refusal, a throttle, or a role that may not send.
            var reason = $"{exception.ErrorCode} ({(int)exception.StatusCode}): {EmailLogText.Mask(exception.Message)}";
            logger.LogWarning(
                "SES did not send the {Purpose} email: {Reason}. Request {RequestId}.",
                message.Purpose, reason, exception.RequestId);
            throw new EmailNotSentException(message.Purpose, reason);
        }
        catch (Exception exception) when (exception
            is AmazonClientException or HttpRequestException or IOException or OperationCanceledException)
        {
            // No answer at all: the network, the client's timeout, or credentials that could not be
            // had. The type says which; the text is masked like SES's, since it is not ours. Anything
            // else is a bug of ours, and leaves as itself.
            var reason = $"{exception.GetType().Name}: {EmailLogText.Mask(exception.Message)}";
            logger.LogWarning("SES could not be reached for the {Purpose} email: {Reason}.", message.Purpose, reason);
            throw new EmailNotSentException(message.Purpose, reason);
        }

        logger.LogInformation("Sent the {Purpose} email through SES as {MessageId}.", message.Purpose, response.MessageId);
    }

    private static Content Utf8(string data) => new() { Data = data, Charset = "UTF-8" };
}
