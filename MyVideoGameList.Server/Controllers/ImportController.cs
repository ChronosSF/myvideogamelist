using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// Uploading, reviewing and committing an import of somebody else's tracker export.
/// </summary>
/// <remarks>
/// <para>
/// Everything here is a write in the sense that matters: the upload stores a file's worth of rows
/// and the commit changes a library. So every endpoint but the two reads uses a method the write
/// guard sees, and the client reaches all of them through <c>apiFetch</c> (ADR 0033).
/// </para>
/// <para>
/// No rate-limit policy. The narrow set on login and register is deliberate (ADR 0033), and these
/// endpoints are authenticated, bounded by the upload limit and bounded again by how many pending
/// jobs an account may hold — which is a better fit than a per-address limit for a route only a
/// signed-in person reaches.
/// </para>
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ImportController(
    IImportService importService,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    /// <summary>The upload limit from §S7, applied to the request body before anything reads it.</summary>
    private const int MaxUploadBytes = 5 * 1024 * 1024;

    [HttpGet("jobs")]
    public async Task<ActionResult<IReadOnlyList<ImportJobDto>>> GetJobs(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return Ok(await importService.GetJobsAsync(user.Id, cancellationToken));
    }

    [HttpGet("jobs/{jobId:guid}")]
    public async Task<ActionResult<ImportReviewDto>> GetReview(Guid jobId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var review = await importService.GetReviewAsync(user.Id, jobId, cancellationToken);
        return review is null ? NotFound() : Ok(review);
    }

    /// <summary>
    /// Takes an export file and answers with the job to review. Writes nothing to the library.
    /// </summary>
    /// <remarks>
    /// The file is read into a string and dropped; it is never written to disk and never kept
    /// beyond the rows parsed out of it. Which preset it is comes from sniffing the content, not
    /// from the extension (§S7) — the service does that, because it is the thing that knows what
    /// the presets are.
    /// </remarks>
    [HttpPost("jobs")]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<ActionResult<ImportJobDto>> CreateJob(
        IFormFile file, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        if (file is null || file.Length == 0)
            return Problem("Choose a file to import.", statusCode: StatusCodes.Status400BadRequest);

        // UTF-8 with the encoding detected from a byte-order mark if there is one: an export saved
        // by a Windows tool may carry one, and a BOM read as content breaks the first field.
        using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var content = await reader.ReadToEndAsync(cancellationToken);

        try
        {
            var job = await importService.CreateJobAsync(user.Id, file.FileName, content, cancellationToken);
            return CreatedAtAction(nameof(GetReview), new { jobId = job.Id }, job);
        }
        catch (ImportRejectedException e)
        {
            // The message is written for a person and is the whole of what went wrong, so it is the
            // detail rather than a generic one. Still a ProblemDetails with a traceId, through the
            // same path as every other failure (ADR 0034).
            return Problem(e.Message, statusCode: StatusCodes.Status400BadRequest);
        }
    }

    /// <summary>Records what the user decided about some rows before committing.</summary>
    [HttpPatch("jobs/{jobId:guid}/rows")]
    public async Task<IActionResult> SetDecisions(
        Guid jobId, [FromBody] ImportDecisionsDto decisions, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return await importService.SetDecisionsAsync(user.Id, jobId, decisions, cancellationToken)
            ? NoContent()
            : NotFound();
    }

    /// <summary>
    /// Writes the chosen rows into the library and closes the job.
    /// </summary>
    /// <remarks>
    /// Answers with every row that did not import and why, which is what the downloadable failure
    /// report is built from — §C5's promise is that nothing is silently lost, and a count alone
    /// does not keep it.
    /// </remarks>
    [HttpPost("jobs/{jobId:guid}/commit")]
    public async Task<ActionResult<ImportResultDto>> Commit(Guid jobId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var result = await importService.CommitAsync(user.Id, jobId, cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("jobs/{jobId:guid}")]
    public async Task<IActionResult> Cancel(Guid jobId, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return await importService.CancelAsync(user.Id, jobId, cancellationToken)
            ? NoContent()
            : NotFound();
    }
}
