using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>What members do on the site, counted for the admin page (ADR 0051).</summary>
public interface IAdminStatsService
{
    Task<AdminStatsDto> GetAsync(CancellationToken cancellationToken);
}
