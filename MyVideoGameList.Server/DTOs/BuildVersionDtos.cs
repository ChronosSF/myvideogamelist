namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Which commit a process was built from, and when its image was built.
/// </summary>
/// <remarks>
/// The SSR server's <c>/version</c> answers the same shape. Compare the two by <see cref="Sha"/>:
/// <see cref="BuiltAt"/> is each image's own, and a re-run that finishes a half-pushed release builds
/// the second image later. Either value is <c>unknown</c> wherever the build did not say: a
/// developer's machine, or an image built without the build arguments.
/// </remarks>
public record BuildVersionDto(string Sha, string BuiltAt);
