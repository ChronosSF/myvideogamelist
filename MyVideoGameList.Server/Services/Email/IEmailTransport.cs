namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Delivers an email that is already composed.
/// </summary>
/// <remarks>
/// <para>
/// Two implementations. <see cref="SesEmailTransport"/> sends through Amazon SES, wherever
/// <c>Email:Ses:Region</c> is configured. <see cref="OutboxEmailTransport"/> writes each message to
/// a folder and sends nothing: that is Development's default, and what the production image run on a
/// developer machine and the integration suite are given. Anywhere else, a deployment that names
/// neither does not start, because an account that cannot be sent its confirmation cannot be
/// confirmed (<c>EmailRegistration</c>).
/// </para>
/// <para>
/// A message that could not be delivered, by either implementation, is an
/// <see cref="EmailNotSentException"/>. Its <see cref="EmailNotSentException.Reason"/> says why, in
/// SES's words or the file system's, with every address masked, because SES's own refusal names the
/// recipient; the transport has logged it already. Cancellation through the token is the one other
/// exception that leaves here. See <c>docs/decisions/0088-*</c>.
/// </para>
/// </remarks>
public interface IEmailTransport
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}
