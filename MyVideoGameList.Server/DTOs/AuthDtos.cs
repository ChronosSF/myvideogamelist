namespace MyVideoGameList.Server.DTOs;

public record RegisterDto(string Email, string Password);

public record LoginDto(string Email, string Password, bool RememberMe = false);

public record UserProfileDto(string Id, string Email, string Theme);

public record UpdateThemeDto(string Theme);
